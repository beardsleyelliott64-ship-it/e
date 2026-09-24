const http=require("http");
const https=require("https");
const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const Stripe=require("stripe");

const PORT=Number(process.env.PORT)||10000;
const ROOT=__dirname;
const cache=new Map();
const premiumUsers=new Set();

function json(res,obj,status=200){const body=JSON.stringify(obj);res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(body)}
function send(res,status,type,body){res.writeHead(status,{"Content-Type":type});res.end(body)}
function cookie(res,val){res.setHeader("Set-Cookie",`elliott=${val}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=604800`)}
function clear(res){
  res.setHeader(
    "Set-Cookie",
    "elliott=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0"
  );
}
function parseCookies(req){const out={};for(const p of (req.headers.cookie||"").split(";")){const [k,...v]=p.trim().split("=");if(k)out[k]=decodeURIComponent(v.join("=")||"")}return out}
function b64url(v){return Buffer.from(v).toString("base64url")}
function sign(v){const s=process.env.SESSION_SECRET||"dev-secret-change-me";return crypto.createHmac("sha256",s).update(v).digest("base64url")}
function sessionSet(res,obj){const raw=b64url(JSON.stringify(obj));cookie(res,raw+"."+sign(raw))}
function sessionGet(req){const c=parseCookies(req).elliott;if(!c)return null;const [raw,sig]=c.split(".");if(!raw||sig!==sign(raw))return null;try{return JSON.parse(Buffer.from(raw,"base64url").toString())}catch{return null}}
function getJSON(url,headers={}){return new Promise((resolve,reject)=>{https.get(url,{headers},r=>{let d="";r.on("data",x=>d+=x);r.on("end",()=>{if(r.statusCode<200||r.statusCode>=300)return reject(new Error(`HTTP ${r.statusCode}: ${d.slice(0,200)}`));try{resolve(JSON.parse(d))}catch(e){reject(e)}})}).on("error",reject)})}
function postForm(url,params,headers={}){return new Promise((resolve,reject)=>{const u=new URL(url),body=new URLSearchParams(params).toString();const req=https.request(u,{method:"POST",headers:{...headers,"Content-Type":"application/x-www-form-urlencoded","Content-Length":Buffer.byteLength(body)}},r=>{let d="";r.on("data",x=>d+=x);r.on("end",()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}})});req.on("error",reject);req.write(body);req.end()})}
function meta(endpoint){
  const key="m:"+endpoint,c=cache.get(key);
  if(c&&Date.now()-c.at<30*60*1000)return Promise.resolve(c.data);
  if(!process.env.METAHUB_API_KEY)throw Error("METAHUB_API_KEY is not configured");
  return getJSON("https://www.metahub.space"+endpoint,{"X-API-Key":process.env.METAHUB_API_KEY,"User-Agent":"ElliottPlus/6.0"}).then(d=>{cache.set(key,{at:Date.now(),data:d});return d})
}
function mapMeta(x,type){return{id:String(x.id||x.imdb_id||x.title),title:x.title||x.name||"Untitled",type:type==="movie"?"Film":"TV",year:x.year||x.release_year||"",image:x.poster||x.poster_url||x.image||x.backdrop||"",genre:Array.isArray(x.genres)?x.genres.slice(0,2).join(", "):(x.genre||""),trailer:x.trailer_id||x.youtube_trailer_id||""}}
function tvmaze(pathname){const key="t:"+pathname,c=cache.get(key);if(c&&Date.now()-c.at<30*60*1000)return Promise.resolve(c.data);return getJSON("https://api.tvmaze.com"+pathname).then(d=>{cache.set(key,{at:Date.now(),data:d});return d})}
function mapTV(x){return{id:"tvmaze-"+x.id,title:x.name||"Untitled",type:"TV",year:x.premiered?x.premiered.slice(0,4):"",image:x.image?.medium||x.image?.original||"",genre:Array.isArray(x.genres)?x.genres.slice(0,2).join(", "):"",trailer:""}}
async function buildHome(){
  const [fm,sm,shows,schedule,updates]=await Promise.all([
    meta("/v1/find?type=movie&limit=30"),
    meta("/v1/find?type=series&limit=30"),
    tvmaze("/shows?page=0"),
    tvmaze(`/schedule?country=GB&date=${new Date().toISOString().slice(0,10)}`),
    tvmaze("/updates/shows?since=week")
  ]);
  const films=(fm.results||fm.data||fm.items||[]).map(x=>mapMeta(x,"movie"));
  const series=(sm.results||sm.data||sm.items||[]).map(x=>mapMeta(x,"series"));
  const tv=(shows||[]).slice(0,30).map(mapTV);
  const week=(schedule||[]).map(x=>mapTV(x.show));
  const changedIds=new Set(Object.keys(updates||{}));
  const changed=(shows||[]).filter(x=>changedIds.has(String(x.id))).map(mapTV);
  const year=[...films,...series,...tv].filter(x=>String(x.year)==="2026");
  const charts=[...films,...series,...tv].slice(0,20);
  return {films,series,tv,week,year,charts,updatedAt:new Date().toISOString()}
}
async function home(req,res){try{const data=await buildHome();json(res,{films:data.films,tv:data.tv.concat(data.series),week:data.week,year:data.year,charts:data.charts,updatedAt:data.updatedAt})}catch(e){json(res,{error:e.message,films:[],tv:[],week:[],year:[],charts:[]},500)}}
function discordAuth(req,res){if(!process.env.DISCORD_CLIENT_ID||!process.env.DISCORD_REDIRECT_URI)return send(res,503,"text/plain; charset=utf-8","Discord OAuth is not configured.");const u=new URL("https://discord.com/oauth2/authorize");u.searchParams.set("client_id",process.env.DISCORD_CLIENT_ID);u.searchParams.set("redirect_uri",process.env.DISCORD_REDIRECT_URI);u.searchParams.set("response_type","code");u.searchParams.set("scope","identify");res.writeHead(302,{Location:u});res.end()}
async function discordCallback(req,res,url){
  try{
    const code=url.searchParams.get("code");if(!code)return send(res,400,"text/plain; charset=utf-8","Missing OAuth code.");
    const token=await postForm("https://discord.com/api/oauth2/token",{client_id:process.env.DISCORD_CLIENT_ID,client_secret:process.env.DISCORD_CLIENT_SECRET,grant_type:"authorization_code",code,redirect_uri:process.env.DISCORD_REDIRECT_URI});
    const user=await getJSON("https://discord.com/api/users/@me",{Authorization:`Bearer ${token.access_token}`});
    sessionSet(res,{user:{id:user.id,username:user.global_name||user.username,avatar:user.avatar?`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`:""},premium:premiumUsers.has(user.id)});
    res.writeHead(302,{Location:"/"});res.end()
  }catch(e){send(res,500,"text/plain; charset=utf-8","Discord sign-in failed: "+e.message)}
}
async function checkout(req,res){
  if(req.method!=="POST")return json(res,{error:"Method not allowed"},405);
  let body="";req.on("data",c=>body+=c);req.on("end",async()=>{try{
    const {plan}=JSON.parse(body||"{}");const price=plan==="yearly"?process.env.STRIPE_PRICE_YEARLY:process.env.STRIPE_PRICE_MONTHLY;
    if(!process.env.STRIPE_SECRET_KEY||!price)return json(res,{error:"Stripe is not configured. Add STRIPE_SECRET_KEY and the selected Stripe Price ID in Render."},503);
    const s=new Stripe(process.env.STRIPE_SECRET_KEY);
    const site=process.env.PUBLIC_SITE_URL||"http://localhost:"+PORT;
    const checkout=await s.checkout.sessions.create({mode:"subscription",line_items:[{price,quantity:1}],success_url:site+"/?premium=success",cancel_url:site+"/?premium=cancelled"});
    json(res,{url:checkout.url})
  }catch(e){json(res,{error:e.message},500)}})
}
function staticFile(req,res,url){
  let p=url.pathname==="/"?"index.html":url.pathname.slice(1);
  if(p.includes(".."))return send(res,400,"text/plain","Bad path");
  const file=path.join(ROOT,p);
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())return send(res,404,"text/plain","Not found");
  const ext=path.extname(file);const types={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".json":"application/json"};
  send(res,200,types[ext]||"application/octet-stream",fs.readFileSync(file))
}
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,`http://${req.headers.host||"localhost"}`);
    if(req.method==="GET"&&url.pathname==="/health")return json(res,{ok:true});
    if(req.method==="GET"&&url.pathname==="/api/home")return home(req,res);
    if(req.method==="GET"&&url.pathname==="/api/me"){const s=sessionGet(req);return json(res,{user:s?.user||null,premium:!!s?.premium})}
    if(req.method==="GET"&&url.pathname==="/auth/discord")return discordAuth(req,res);
    if(req.method==="GET"&&url.pathname==="/auth/discord/callback")return discordCallback(req,res,url);
    if(req.method==="GET"&&url.pathname==="/logout"){clear(res);res.writeHead(302,{Location:"/"});return res.end()}
    if(url.pathname==="/api/checkout")return checkout(req,res);
    return staticFile(req,res,url);
  }catch(e){json(res,{error:e.message},500)}
});
server.listen(PORT,"0.0.0.0",()=>console.log(`Elliott+ listening on 0.0.0.0:${PORT}`));
