const http=require("http"),https=require("https"),fs=require("fs"),path=require("path"),crypto=require("crypto");
const Stripe=require("stripe");
const PORT=Number(process.env.PORT||10000),ROOT=__dirname,SECRET=process.env.SESSION_SECRET||"change-me";
const stripe=process.env.STRIPE_SECRET_KEY?Stripe(process.env.STRIPE_SECRET_KEY):null;
const sessions=new Map(),cache=new Map(),premium=new Set();

function getJSON(url,headers={}){return new Promise((resolve,reject)=>https.get(url,{headers},r=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>{try{resolve({status:r.statusCode,data:JSON.parse(d)})}catch{resolve({status:r.statusCode,data:d})}})}).on("error",reject))}
function postJSON(url,body,headers={}){return new Promise((resolve,reject)=>{const u=new URL(url),r=https.request(u,{method:"POST",headers:{...headers,"Content-Length":Buffer.byteLength(body)}},x=>{let d="";x.on("data",c=>d+=c);x.on("end",()=>{try{resolve({status:x.statusCode,data:JSON.parse(d)})}catch{resolve({status:x.statusCode,data:d})}})});r.on("error",reject);r.write(body);r.end()})}
function api(res,status,data){const b=JSON.stringify(data);res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(b)}
function sign(x){return crypto.createHmac("sha256",SECRET).update(x).digest("hex")}
function getSession(req){const c=(req.headers.cookie||"").split(";").map(x=>x.trim()).find(x=>x.startsWith("elliott="));if(!c)return null;const [id,s]=c.slice(8).split(".");if(!id||sign(id)!==s)return null;return sessions.get(id)||null}
function setSession(res,user){const id=crypto.randomBytes(24).toString("hex");sessions.set(id,{user,at:Date.now()});res.setHeader("Set-Cookie",`elliott=${id}.${sign(id)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=2592000`)}
function clear(res){
  res.setHeader("Set-Cookie","elliott=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0");
}
function meta(endpoint){const key="m:"+endpoint,c=cache.get(key);if(c&&Date.now()-c.at<30*60*1000)return Promise.resolve(c.data);if(!process.env.METAHUB_API_KEY)throw Error("METAHUB_API_KEY is not configured");return getJSON("https://www.metahub.space"+endpoint,{"X-API-Key":process.env.METAHUB_API_KEY,"User-Agent":"ElliottPlus/6.0"}).then(r=>{if(r.status>=400)throw Error("MetaHub request failed");cache.set(key,{at:Date.now(),data:r.data});return r.data})}
function tv(endpoint){const key="t:"+endpoint,c=cache.get(key);if(c&&Date.now()-c.at<30*60*1000)return Promise.resolve(c.data);return getJSON("https://api.tvmaze.com"+endpoint,{"User-Agent":"ElliottPlus/6.0"}).then(r=>{if(r.status>=400)throw Error("TVmaze request failed");cache.set(key,{at:Date.now(),data:r.data});return r.data})}
function mapMeta(x){return{id:x.imdb_id||x.id,title:x.name||"Untitled",type:x.type==="movie"?"FILM":"TV",year:String(x.year||x.releaseInfo||"").slice(0,4),meta:[x.releaseInfo||x.year||"",Array.isArray(x.genres)?x.genres.slice(0,2).join(" · "):""].filter(Boolean).join(" • "),trailer:x.trailers?.[0]?.source||""}}
function mapTV(x){return{id:"tv-"+x.id,title:x.name||"Untitled",type:"TV",year:(x.premiered||"").slice(0,4),meta:[x.premiered||"",x.genres?.slice(0,2).join(" · ")||""].filter(Boolean).join(" • "),trailer:""}}
async function feed(){
let movies=[],series=[],week=[],y2026=[];
if(process.env.METAHUB_API_KEY){
const [m,s]=await Promise.all([meta("/v1/find?type=movie&limit=30"),meta("/v1/find?type=series&limit=30")]);
movies=(Array.isArray(m)?m:[]).map(mapMeta);series=(Array.isArray(s)?s:[]).map(mapMeta);
}
try{const [shows,schedule,updates]=await Promise.all([tv("/shows?page=0"),tv("/schedule?country=GB&date="+new Date().toISOString().slice(0,10)),tv("/updates/shows?since=week")]);
const sched=(Array.isArray(schedule)?schedule:[]).map(e=>mapTV(e.show));
const fresh=(Array.isArray(updates)?updates.slice(0,25):[]).map(x=>({id:"tv-"+x.id,title:"Updated show #"+x.id,type:"TV",year:"",meta:"Updated recently"}));
const base=(Array.isArray(shows)?shows.slice(0,30):[]).map(mapTV);
series=[...sched,...base.filter(b=>!sched.some(s=>s.id===b.id)),...fresh].slice(0,50);
week=[...sched,...fresh,...base].slice(0,30);
}catch(e){if(!movies.length)throw e}
y2026=[...movies.filter(x=>x.year==="2026"),...series.filter(x=>x.year==="2026")];
return {movies,series,week,y2026,charts:[...movies,...series].slice(0,24)}}
async function discordUser(code){
const body=new URLSearchParams({client_id:process.env.DISCORD_CLIENT_ID,client_secret:process.env.DISCORD_CLIENT_SECRET,grant_type:"authorization_code",code,redirect_uri:process.env.DISCORD_REDIRECT_URI}).toString();
const token=await postJSON("https://discord.com/api/oauth2/token",body,{"Content-Type":"application/x-www-form-urlencoded"});
if(!token.data.access_token)throw Error("Discord OAuth failed");
const me=await getJSON("https://discord.com/api/users/@me",{Authorization:"Bearer "+token.data.access_token}),u=me.data;
return{id:u.id,username:u.username,globalName:u.global_name||u.username,avatarUrl:u.avatar?`https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`:null}}
async function checkout(req,res,plan){
if(!stripe)return api(res,503,{error:"Stripe is not configured yet."});
const s=getSession(req);if(!s)return api(res,401,{error:"Sign in with Discord first."});
const price=plan==="yearly"?process.env.STRIPE_PRICE_YEARLY:process.env.STRIPE_PRICE_MONTHLY;if(!price)return api(res,503,{error:"Stripe Price ID is missing."});
const base=process.env.PUBLIC_SITE_URL||`https://${process.env.RENDER_EXTERNAL_HOSTNAME||"localhost:"+PORT}`;
const c=await stripe.checkout.sessions.create({mode:"subscription",line_items:[{price,quantity:1}],success_url:base+"/?premium=success#Premium",cancel_url:base+"/#Premium",client_reference_id:s.user.id,metadata:{discord_id:s.user.id},allow_promotion_codes:true});
api(res,200,{url:c.url})}
async function main(req,res){
const u=new URL(req.url,"http://localhost");
if(u.pathname==="/api/feed"){try{return api(res,200,await feed())}catch(e){return api(res,500,{error:e.message})}}
if(u.pathname==="/api/me"){const s=getSession(req);return api(res,200,{user:s?{...s.user,premium:premium.has(s.user.id)}:null})}
if(u.pathname==="/api/checkout"){let body="";req.on("data",c=>body+=c);req.on("end",()=>{let x={};try{x=JSON.parse(body)}catch{};checkout(req,res,x.plan==="yearly"?"yearly":"monthly").catch(e=>api(res,500,{error:e.message}))});return}
if(u.pathname==="/auth/discord"){if(!process.env.DISCORD_CLIENT_ID||!process.env.DISCORD_REDIRECT_URI)return api(res,503,{error:"Discord OAuth is not configured"});const p=new URLSearchParams({client_id:process.env.DISCORD_CLIENT_ID,response_type:"code",redirect_uri:process.env.DISCORD_REDIRECT_URI,scope:"identify"});res.writeHead(302,{Location:"https://discord.com/oauth2/authorize?"+p});return res.end()}
if(u.pathname==="/auth/discord/callback"){try{const user=await discordUser(u.searchParams.get("code"));setSession(res,user);res.writeHead(302,{Location:"/"});return res.end()}catch(e){return api(res,400,{error:e.message})}}
if(u.pathname==="/auth/logout"){clear(res);res.writeHead(302,{Location:"/"});return res.end()}
const file=u.pathname==="/"?"index.html":u.pathname.replace(/^\/+/,"");if(file.includes(".."))return api(res,400,{error:"Bad path"});const full=path.join(ROOT,file);fs.readFile(full,(err,b)=>{if(err){res.writeHead(404);return res.end("Not found")}const ext=path.extname(full),ct={".html":"text/html; charset=utf-8",".css":"text/css",".js":"text/javascript",".json":"application/json"}[ext]||"application/octet-stream";res.writeHead(200,{"Content-Type":ct});res.end(b)})}
http.createServer((req,res)=>main(req,res).catch(e=>api(res,500,{error:e.message}))).listen(PORT,"0.0.0.0",()=>console.log("Elliott+ v6 on "+PORT));