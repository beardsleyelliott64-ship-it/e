const http=require("http"),https=require("https"),fs=require("fs"),path=require("path"),crypto=require("crypto");
const PORT=process.env.PORT||10000,ROOT=__dirname;
const TMDB=process.env.TMDB_API_KEY;
const CID=process.env.DISCORD_CLIENT_ID,SECRET=process.env.DISCORD_CLIENT_SECRET;
const SESSION_SECRET=process.env.SESSION_SECRET||crypto.randomBytes(32).toString("hex");
const REDIRECT=process.env.DISCORD_REDIRECT_URI||`${process.env.RENDER_EXTERNAL_URL||"http://localhost:"+PORT}/auth/discord/callback`;
const sessions=new Map(),cache=new Map(),TTL=1000*60*20;
const MIME={".html":"text/html; charset=utf-8",".js":"application/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".svg":"image/svg+xml"};
function json(res,s,d){res.writeHead(s,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(d))}
function redir(res,u){res.writeHead(302,{Location:u});res.end()}
function cookies(req){const o={};for(const p of (req.headers.cookie||"").split(";")){const i=p.indexOf("=");if(i>0)o[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1))}return o}
function b64(b){return Buffer.from(b).toString("base64url")}
function sign(v){return v+"."+b64(crypto.createHmac("sha256",SESSION_SECRET).update(v).digest())}
function unsign(v){if(!v)return null;const i=v.lastIndexOf(".");if(i<1)return null;const raw=v.slice(0,i),sig=v.slice(i+1),e=crypto.createHmac("sha256",SESSION_SECRET).update(raw).digest(),g=Buffer.from(sig,"base64url");return g.length===e.length&&crypto.timingSafeEqual(g,e)?raw:null}
function cookie(res,n,v,max=3600){const secure=process.env.NODE_ENV==="production"||process.env.RENDER==="true";res.setHeader("Set-Cookie",`${n}=${encodeURIComponent(v)}; Max-Age=${max}; Path=/; HttpOnly; SameSite=Lax${secure?"; Secure":""}`)}
function clear(res,n){cookie(res,n,"",0)}
function reqHttps(url,opt={},body=""){return new Promise((resolve,reject)=>{const r=https.request(url,{...opt,headers:{...(opt.headers||{}),...(body?{"Content-Length":Buffer.byteLength(body)}:{})}},x=>{let d="";x.setEncoding("utf8");x.on("data",c=>d+=c);x.on("end",()=>resolve({status:x.statusCode,body:d,headers:x.headers}))});r.on("error",reject);if(body)r.write(body);r.end()})}
function form(o){return Object.entries(o).map(([k,v])=>encodeURIComponent(k)+"="+encodeURIComponent(v)).join("&")}
function avatar(u){if(u.avatar)return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`;return `https://cdn.discordapp.com/embed/avatars/${(BigInt(u.id)>>22n)%6n}.png`}
async function tmdb(endpoint){
 if(!TMDB)throw new Error("TMDB_API_KEY is missing in Render Environment.");
 const now=Date.now(),old=cache.get(endpoint);if(old&&now-old.t<TTL)return old.d;
 const r=await reqHttps("https://api.themoviedb.org/3"+endpoint,{headers:{Authorization:`Bearer ${TMDB}`,Accept:"application/json"}});
 if(r.status!==200)throw new Error("TMDB request failed ("+r.status+").");
 const d=JSON.parse(r.body);cache.set(endpoint,{t:now,d});return d;
}
async function oauth(req,res,u){
 if(u.pathname==="/auth/discord"){
  if(!CID||!SECRET)return json(res,503,{error:"Discord OAuth is not configured."});
  const state=b64(crypto.randomBytes(24));cookie(res,"oauth_state",sign(state),600);
  const q=new URLSearchParams({client_id:CID,redirect_uri:REDIRECT,response_type:"code",scope:"identify",state});
  return redir(res,"https://discord.com/oauth2/authorize?"+q);
 }
 if(u.pathname==="/auth/discord/callback"){
  const state=unsign(cookies(req).oauth_state),code=u.searchParams.get("code");
  if(!state||state!==u.searchParams.get("state"))return json(res,400,{error:"Invalid OAuth state"});
  try{
   const t=await reqHttps("https://discord.com/api/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"}},form({client_id:CID,client_secret:SECRET,grant_type:"authorization_code",code,redirect_uri:REDIRECT}));
   if(t.status!==200)throw Error("Discord token exchange failed");
   const td=JSON.parse(t.body),me=await reqHttps("https://discord.com/api/users/@me",{headers:{Authorization:"Bearer "+td.access_token}});
   const u=JSON.parse(me.body),user={id:u.id,username:u.username,globalName:u.global_name||u.username,avatarUrl:avatar(u)};
   const sid=b64(crypto.randomBytes(32));sessions.set(sid,{user,at:Date.now()});cookie(res,"session",sign(sid),604800);return redir(res,"/#home");
  }catch(e){console.error(e);return redir(res,"/#home")}
 }
 if(u.pathname==="/auth/logout"){const s=unsign(cookies(req).session);if(s)sessions.delete(s);clear(res,"session");return json(res,200,{ok:true})}
 return false;
}
const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,`http://${req.headers.host||"localhost"}`);
 if(req.method==="GET"||req.method==="POST"){const a=await oauth(req,res,u);if(a!==false)return}
 if(req.method==="GET"&&u.pathname==="/api/me"){const s=unsign(cookies(req).session),x=s&&sessions.get(s);return json(res,200,{user:x?.user||null})}
 if(req.method==="GET"&&u.pathname.startsWith("/api/")){
  try{
   let d;
   const p=u.pathname;
   if(p==="/api/trending/all/week")d=await tmdb("/trending/all/week?language=en-GB");
   else if(p==="/api/films/trending")d=await tmdb("/trending/movie/week?language=en-GB");
   else if(p==="/api/films/popular")d=await tmdb("/movie/popular?language=en-GB&page=1");
   else if(p==="/api/films/now")d=await tmdb("/movie/now_playing?language=en-GB&region=GB&page=1");
   else if(p==="/api/films/upcoming")d=await tmdb("/movie/upcoming?language=en-GB&region=GB&page=1");
   else if(p==="/api/tv/trending")d=await tmdb("/trending/tv/week?language=en-GB");
   else if(p==="/api/tv/popular")d=await tmdb("/tv/popular?language=en-GB&page=1");
   else if(p==="/api/tv/airing")d=await tmdb("/tv/airing_today?language=en-GB&page=1");
   else if(p==="/api/tv/onair")d=await tmdb("/tv/on_the_air?language=en-GB&page=1");
   else return json(res,404,{error:"Unknown API route"});
   return json(res,200,d);
  }catch(e){return json(res,500,{error:e.message})}
 }
 if(req.method==="GET"){
  let file=u.pathname==="/" ? path.join(ROOT,"index.html") : path.normalize(path.join(ROOT,u.pathname));
  if(!file.startsWith(ROOT))return json(res,403,{error:"Forbidden"});
  fs.readFile(file,(err,data)=>{if(!err){res.writeHead(200,{"Content-Type":MIME[path.extname(file).toLowerCase()]||"application/octet-stream"});return res.end(data)}fs.readFile(path.join(ROOT,"index.html"),(e,d)=>{if(e)return json(res,500,{error:"Server error"});res.writeHead(200,{"Content-Type":MIME[".html"]});res.end(d)})});
  return;
 }
 json(res,404,{error:"Not found"});
});
server.listen(PORT,"0.0.0.0",()=>console.log("Elliott+ listening on "+PORT));
