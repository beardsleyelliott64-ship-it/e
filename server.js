const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 10000;
const ROOT = __dirname;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI ||
  `${process.env.RENDER_EXTERNAL_URL || "http://localhost:" + PORT}/auth/discord/callback`;

const sessions = new Map();
const MIME = {
  ".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"application/javascript; charset=utf-8",
  ".json":"application/json; charset=utf-8",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",
  ".svg":"image/svg+xml",".ico":"image/x-icon",".webp":"image/webp"
};

function parseCookies(req){
  const out={};
  for(const part of (req.headers.cookie||"").split(";")){
    const i=part.indexOf("=");
    if(i>0) out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1));
  }
  return out;
}
function setCookie(res,name,value,maxAge=3600){
  const secure=process.env.NODE_ENV==="production"||process.env.RENDER==="true" ? "; Secure" : "";
  res.setHeader("Set-Cookie",`${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`);
}
function clearCookie(res,name){res.setHeader("Set-Cookie",`${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`)}
function base64url(buf){return Buffer.from(buf).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");}
function randomToken(){return base64url(crypto.randomBytes(32));}
function signed(value){
  const sig=base64url(crypto.createHmac("sha256",SESSION_SECRET).update(value).digest());
  return `${value}.${sig}`;
}
function unsign(value){
  if(!value)return null;
  const i=value.lastIndexOf(".");
  if(i<1)return null;
  const raw=value.slice(0,i), sig=value.slice(i+1);
  const expected=crypto.createHmac("sha256",SESSION_SECRET).update(raw).digest();
  try{
    const got=Buffer.from(sig.replace(/-/g,"+").replace(/_/g,"/")+"==","base64");
    if(got.length!==expected.length || !crypto.timingSafeEqual(got,expected))return null;
  }catch{return null}
  return raw;
}
function json(res,status,data){
  res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
  res.end(JSON.stringify(data));
}
function redirect(res,url){res.writeHead(302,{Location:url});res.end();}
function httpsRequest(url,options={},body=null){
  return new Promise((resolve,reject)=>{
    const req=https.request(url,{...options,headers:{...(options.headers||{}),...(body?{"Content-Length":Buffer.byteLength(body)}:{})}},r=>{
      let data="";r.setEncoding("utf8");r.on("data",d=>data+=d);r.on("end",()=>resolve({status:r.statusCode,headers:r.headers,body:data}));
    });
    req.on("error",reject);if(body)req.write(body);req.end();
  });
}
function formBody(obj){return Object.entries(obj).map(([k,v])=>encodeURIComponent(k)+"="+encodeURIComponent(v)).join("&");}
function avatarUrl(user){
  if(user.avatar)return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
  const index=(BigInt(user.id)>>22n)%6n;
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

async function discordUser(accessToken){
  const r=await httpsRequest("https://discord.com/api/users/@me",{headers:{Authorization:`Bearer ${accessToken}`}});
  if(r.status!==200)throw new Error("Discord user lookup failed");
  return JSON.parse(r.body);
}

async function handleAuth(req,res,url){
  if(url.pathname==="/auth/discord"){
    if(!CLIENT_ID||!CLIENT_SECRET)return json(res,503,{error:"Discord OAuth is not configured on this Render service yet."});
    const state=randomToken();
    setCookie(res,"discord_oauth_state",signed(state),600);
    const q=new URLSearchParams({client_id:CLIENT_ID,redirect_uri:REDIRECT_URI,response_type:"code",scope:"identify",state});
    return redirect(res,`https://discord.com/oauth2/authorize?${q.toString()}`);
  }
  if(url.pathname==="/auth/discord/callback"){
    const state=unsign(parseCookies(req).discord_oauth_state);
    if(!state || state!==url.searchParams.get("state"))return json(res,400,{error:"Invalid OAuth state."});
    const code=url.searchParams.get("code");
    if(!code)return redirect(res,"/#home");
    try{
      const token=await httpsRequest("https://discord.com/api/oauth2/token",{
        method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"}
      },formBody({client_id:CLIENT_ID,client_secret:CLIENT_SECRET,grant_type:"authorization_code",code,redirect_uri:REDIRECT_URI}));
      if(token.status!==200)throw new Error("Token exchange failed");
      const tokenData=JSON.parse(token.body);
      const rawUser=await discordUser(tokenData.access_token);
      const user={
        id:rawUser.id,username:rawUser.username,globalName:rawUser.global_name||rawUser.username,
        avatarUrl:avatarUrl(rawUser)
      };
      const sid=randomToken();sessions.set(sid,{user,createdAt:Date.now()});
      setCookie(res,"elliott_session",signed(sid),60*60*24*7);
      setCookie(res,"discord_oauth_state","",0);
      return redirect(res,"/#home");
    }catch(err){
      console.error(err);
      return redirect(res,"/#home?discord_error=1");
    }
  }
  if(url.pathname==="/auth/logout"){
    const sid=unsign(parseCookies(req).elliott_session);if(sid)sessions.delete(sid);
    clearCookie(res,"elliott_session");return json(res,200,{ok:true});
  }
  return false;
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||"localhost"}`);
  if(req.method==="GET" || req.method==="POST"){
    const authResult=await handleAuth(req,res,url);
    if(authResult!==false)return;
  }
  if(req.method==="GET" && url.pathname==="/api/me"){
    const sid=unsign(parseCookies(req).elliott_session);
    const session=sid?sessions.get(sid):null;
    return json(res,200,{user:session?.user||null});
  }
  if(req.method==="GET"){
    let filePath=url.pathname==="/" ? path.join(ROOT,"index.html") : path.join(ROOT,url.pathname);
    filePath=path.normalize(filePath);
    if(!filePath.startsWith(ROOT))return json(res,403,{error:"Forbidden"});
    fs.readFile(filePath,(err,data)=>{
      if(!err){
        res.writeHead(200,{"Content-Type":MIME[path.extname(filePath).toLowerCase()]||"application/octet-stream"});
        return res.end(data);
      }
      fs.readFile(path.join(ROOT,"index.html"),(fallbackErr,fallbackData)=>{
        if(fallbackErr)return json(res,500,{error:"Server error"});
        res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(fallbackData);
      });
    });
    return;
  }
  json(res,404,{error:"Not found"});
});

server.listen(PORT,"0.0.0.0",()=>console.log(`Elliott+ running on ${PORT}`));
