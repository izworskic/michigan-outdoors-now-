const LAT = 46.57490;
const LON = -85.25659;
const USGS_SITE = '04045500';
const USER_AGENT = 'TahquamenonFallsLive/1.0 (chrisizworski.com)';

const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const safeNumber = value => { const n = Number(value); return Number.isFinite(n) ? n : null; };

async function fetchJson(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { const r = await fetch(url, { ...options, signal: controller.signal }); if (!r.ok) throw new Error(`${r.status} ${r.statusText}`); return await r.json(); }
  finally { clearTimeout(timer); }
}
async function fetchText(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { const r = await fetch(url, { ...options, signal: controller.signal }); if (!r.ok) throw new Error(`${r.status} ${r.statusText}`); return await r.text(); }
  finally { clearTimeout(timer); }
}

function parseUsgsSeries(payload) {
  const out = { cfs: null, gageHeightFt: null, precipIn: null, observedAt: null };
  for (const item of payload?.value?.timeSeries || []) {
    const code = item?.variable?.variableCode?.[0]?.value;
    const values = item?.values?.[0]?.value || []; const latest = values[values.length - 1]; if (!latest) continue;
    const value = safeNumber(latest.value);
    if (code === '00060') out.cfs = value; if (code === '00065') out.gageHeightFt = value; if (code === '00045') out.precipIn = value;
    if (!out.observedAt || new Date(latest.dateTime) > new Date(out.observedAt)) out.observedAt = latest.dateTime;
  }
  return out;
}

function parseStatsRdb(text, month, day) {
  const lines = String(text || '').split(/\r?\n/).filter(line => line && !line.startsWith('#')); if (lines.length < 3) return null;
  const headers = lines[0].split('\t'); const dataLines = lines.slice(2); const index = key => headers.findIndex(h => h === key);
  const mi = index('month_nu'), di = index('day_nu');
  const row = dataLines.map(line => line.split('\t')).find(cols => Number(cols[mi]) === month && Number(cols[di]) === day); if (!row) return null;
  const read = key => { const i = index(key); return i >= 0 ? safeNumber(row[i]) : null; };
  return { p05: read('p05_va'), p25: read('p25_va'), median: read('p50_va'), p75: read('p75_va'), p95: read('p95_va'), mean: read('mean_va'), years: read('count_nu') };
}

function percentileEstimate(cfs, stats) {
  if (!Number.isFinite(cfs) || !stats) return null;
  const points = [[stats.p05,5],[stats.p25,25],[stats.median,50],[stats.p75,75],[stats.p95,95]].filter(([x]) => Number.isFinite(x)).sort((a,b) => a[0]-b[0]);
  if (points.length < 2) return null;
  if (cfs <= points[0][0]) return Math.max(1, Math.round((cfs / Math.max(points[0][0],1)) * points[0][1]));
  if (cfs >= points.at(-1)[0]) { const top = points.at(-1); return Math.min(99, Math.round(top[1] + (1 - Math.exp(-(cfs-top[0])/Math.max(top[0],1))) * (99-top[1]))); }
  for (let i=1;i<points.length;i++) if (cfs <= points[i][0]) { const [x0,p0]=points[i-1],[x1,p1]=points[i]; return Math.round(p0 + ((cfs-x0)/Math.max(x1-x0,1))*(p1-p0)); }
  return null;
}

function riverExperienceScore(cfs, percentile) {
  if (!Number.isFinite(cfs)) return null;
  let power;
  if (cfs < 200) power = 38 + (cfs/200)*12;
  else if (cfs < 400) power = 50 + ((cfs-200)/200)*12;
  else if (cfs < 800) power = 62 + ((cfs-400)/400)*13;
  else if (cfs < 1600) power = 75 + ((cfs-800)/800)*12;
  else if (cfs < 3200) power = 87 + ((cfs-1600)/1600)*9;
  else power = 96 + Math.min(4, Math.log10(cfs/3200+1)*8);
  const relative = Number.isFinite(percentile) ? 40 + percentile*.6 : power;
  return Math.round(clamp(power*.72 + relative*.28));
}

function scoreWeather(weather, alerts = []) {
  const { tempF: temp, windMph: wind, precipChance, cloudCover: cloud } = weather;
  let trail = 88;
  if (Number.isFinite(temp)) { trail -= Math.min(28, Math.abs(temp-62)*.8); if (temp < 25 || temp > 90) trail -= 12; }
  if (Number.isFinite(wind)) trail -= Math.max(0, wind-12)*1.2;
  if (Number.isFinite(precipChance)) trail -= precipChance*.22;
  let photo = 72;
  if (Number.isFinite(cloud)) photo += 18 - Math.abs(cloud-48)*.34;
  if (Number.isFinite(precipChance)) photo -= precipChance*.10;
  if (Number.isFinite(wind)) photo -= Math.max(0, wind-18)*.7;
  const severe = alerts.some(a => /Tornado|Severe Thunderstorm|Flash Flood|Extreme Wind|Blizzard|Ice Storm/i.test(a.event || ''));
  const notable = alerts.some(a => /Flood|Winter Storm|High Wind|Dense Fog|Red Flag|Heat|Cold|Wind Chill/i.test(a.event || ''));
  return { trail: Math.round(clamp(trail)), photo: Math.round(clamp(photo)), safety: severe ? 5 : notable ? 45 : 96 };
}
function labelForScore(score) { if (score>=88) return {label:'Exceptional',state:'go'}; if(score>=74)return{label:'Go',state:'go'}; if(score>=60)return{label:'Good',state:'good'}; if(score>=45)return{label:'Mixed',state:'mixed'}; return{label:'Hold',state:'hold'}; }
function flowWords(percentile,cfs) { if(!Number.isFinite(cfs))return'River reading unavailable'; if(Number.isFinite(percentile)){ if(percentile>=90)return'exceptionally high for the date'; if(percentile>=75)return'high for the date'; if(percentile>=55)return'a little above typical for the date'; if(percentile>=40)return'near typical for the date'; if(percentile>=25)return'below typical for the date'; return'very low for the date'; } if(cfs>=1600)return'powerful'; if(cfs>=800)return'strong'; if(cfs>=400)return'moderate'; return'low'; }

function buildDecision({ river, stats, weather, alerts, sourceHealth }) {
  const percentile = percentileEstimate(river.cfs, stats); const riverScore = riverExperienceScore(river.cfs, percentile); const wx = scoreWeather(weather, alerts);
  let score = riverScore == null ? Math.round(wx.trail*.45 + wx.photo*.25 + wx.safety*.30) : Math.round(riverScore*.46 + wx.trail*.24 + wx.photo*.18 + wx.safety*.12);
  if (wx.safety <= 10) score = Math.min(score,25); const meta = labelForScore(score);
  let confidence = 100; if(!sourceHealth.usgs)confidence-=38; if(!sourceHealth.nws&&sourceHealth.openMeteo)confidence-=12; if(!sourceHealth.nws&&!sourceHealth.openMeteo)confidence-=30; if(!stats)confidence-=8;
  if(river.observedAt){const age=(Date.now()-new Date(river.observedAt).getTime())/60000;if(age>120)confidence-=20;else if(age>45)confidence-=8;} else if(sourceHealth.usgs) confidence-=15; confidence=clamp(Math.round(confidence));
  const reasons=[];
  if(riverScore!=null)reasons.push(`${Math.round(river.cfs)} cfs is ${flowWords(percentile,river.cfs)}${Number.isFinite(percentile)?` (~${percentile}th percentile)`:''}.`); else reasons.push('Fresh USGS discharge is unavailable, so the tool is not claiming a current waterfall-flow score.');
  if(Number.isFinite(weather.tempF))reasons.push(`${Math.round(weather.tempF)}°F with ${Math.round(weather.windMph||0)} mph wind shapes trail comfort.`);
  if(alerts.length)reasons.push(`${alerts.length} active NWS alert${alerts.length===1?'':'s'} affect the safety score.`); else reasons.push('No active NWS hazard in the normalized feed.');
  let outlook='No strong flow change signal yet.';
  if(Number.isFinite(weather.qpf24In)){if(weather.qpf24In>=.75)outlook=`${weather.qpf24In.toFixed(2)} in of forecast precipitation in the next 24 hours could lift river flow later; it is not counted as current flow.`;else if(weather.qpf24In>=.25)outlook=`${weather.qpf24In.toFixed(2)} in of forecast precipitation may modestly improve flow later; it is kept separate from the current score.`;else outlook=`Only ${weather.qpf24In.toFixed(2)} in of forecast precipitation in the next 24 hours, so a rain-driven flow jump is not strongly signaled.`;}
  return { score, ...meta, confidence, riverScore, trailScore:wx.trail, photoScore:wx.photo, safetyScore:wx.safety, percentile, flowContext:flowWords(percentile,river.cfs), reasons, outlook };
}

async function getUsgs(){
  const ivUrl=`https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${USGS_SITE}&parameterCd=00060,00065,00045&siteStatus=all`;
  const statsUrl=`https://waterservices.usgs.gov/nwis/stat/?format=rdb&site=${USGS_SITE}&parameterCd=00060&statReportType=daily&statType=all`;
  const [iv,statsText]=await Promise.all([fetchJson(ivUrl,{headers:{'User-Agent':USER_AGENT}}),fetchText(statsUrl,{headers:{'User-Agent':USER_AGENT}}).catch(()=>null)]);
  const now=new Date(); return {river:parseUsgsSeries(iv),stats:statsText?parseStatsRdb(statsText,now.getUTCMonth()+1,now.getUTCDate()):null};
}
function parseNwsWind(text){const m=String(text||'').match(/(\d+)/);return m?Number(m[1]):null;}
async function getNws(){
  const headers={'User-Agent':USER_AGENT,Accept:'application/geo+json, application/json'}; const point=await fetchJson(`https://api.weather.gov/points/${LAT},${LON}`,{headers});
  const [hourly,daily,alertPayload]=await Promise.all([fetchJson(point.properties.forecastHourly,{headers}),fetchJson(point.properties.forecast,{headers}).catch(()=>null),fetchJson(`https://api.weather.gov/alerts/active?point=${LAT},${LON}`,{headers}).catch(()=>({features:[]}))]);
  const now=hourly?.properties?.periods?.[0]||{}; const alerts=(alertPayload?.features||[]).map(f=>({event:f?.properties?.event,severity:f?.properties?.severity,headline:f?.properties?.headline,expires:f?.properties?.expires,instruction:f?.properties?.instruction}));
  return {weather:{tempF:safeNumber(now.temperature),feelsLikeF:null,windMph:parseNwsWind(now.windSpeed),windDirection:now.windDirection||null,shortForecast:now.shortForecast||null,precipChance:safeNumber(now?.probabilityOfPrecipitation?.value),humidity:safeNumber(now?.relativeHumidity?.value),cloudCover:null,qpf24In:null,forecastPeriods:(daily?.properties?.periods||[]).slice(0,6)},alerts};
}
async function getOpenMeteo(){
  const url=`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,apparent_temperature,precipitation,cloud_cover,wind_speed_10m,wind_direction_10m&hourly=precipitation_probability,precipitation,cloud_cover&daily=sunrise,sunset&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=America%2FDetroit&forecast_days=3`;
  const p=await fetchJson(url),c=p.current||{},times=p.hourly?.time||[],i=Math.max(0,times.findIndex(t=>new Date(t)>=new Date()));
  const precip=(p.hourly?.precipitation||[]).slice(i,i+24).map(safeNumber).filter(Number.isFinite),prob=(p.hourly?.precipitation_probability||[]).slice(i,i+24).map(safeNumber).filter(Number.isFinite);
  return {weather:{tempF:safeNumber(c.temperature_2m),feelsLikeF:safeNumber(c.apparent_temperature),windMph:safeNumber(c.wind_speed_10m),windDirectionDegrees:safeNumber(c.wind_direction_10m),shortForecast:null,precipChance:prob.length?prob[0]:null,humidity:null,cloudCover:safeNumber(c.cloud_cover),qpf24In:precip.reduce((a,b)=>a+b,0),currentPrecipIn:safeNumber(c.precipitation)},daylight:{sunrise:p.daily?.sunrise?.[0]||null,sunset:p.daily?.sunset?.[0]||null}};
}
function mergeWeather(nws,om){const nw=nws?.weather||{},ow=om?.weather||{},choose=(a,b)=>a!==null&&a!==undefined?a:b;return{tempF:choose(nw.tempF,ow.tempF),feelsLikeF:choose(nw.feelsLikeF,ow.feelsLikeF),windMph:choose(nw.windMph,ow.windMph),windDirection:choose(nw.windDirection,ow.windDirectionDegrees),shortForecast:choose(nw.shortForecast,'Live weather'),precipChance:choose(nw.precipChance,ow.precipChance),humidity:choose(nw.humidity,ow.humidity),cloudCover:choose(ow.cloudCover,nw.cloudCover),qpf24In:choose(ow.qpf24In,nw.qpf24In),currentPrecipIn:ow.currentPrecipIn??null,forecastPeriods:nw.forecastPeriods||[]};}

export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const started=Date.now(),sourceHealth={usgs:false,nws:false,openMeteo:false},sourceErrors={};
  const [ur,nr,or]=await Promise.allSettled([getUsgs(),getNws(),getOpenMeteo()]); let usgs={river:{},stats:null},nws={weather:{},alerts:[]},om={weather:{},daylight:{}};
  if(ur.status==='fulfilled'){usgs=ur.value;sourceHealth.usgs=Number.isFinite(usgs.river.cfs);}else sourceErrors.usgs=ur.reason?.message||'USGS unavailable';
  if(nr.status==='fulfilled'){nws=nr.value;sourceHealth.nws=Number.isFinite(nws.weather.tempF);}else sourceErrors.nws=nr.reason?.message||'NWS unavailable';
  if(or.status==='fulfilled'){om=or.value;sourceHealth.openMeteo=Number.isFinite(om.weather.tempF);}else sourceErrors.openMeteo=or.reason?.message||'Open-Meteo unavailable';
  const weather=mergeWeather(nws,om),decision=buildDecision({river:usgs.river,stats:usgs.stats,weather,alerts:nws.alerts,sourceHealth});
  const payload={generatedAt:new Date().toISOString(),latencyMs:Date.now()-started,location:{name:'Tahquamenon Upper Falls',lat:LAT,lon:LON,timezone:'America/Detroit'},river:{...usgs.river,site:USGS_SITE,stats:usgs.stats},weather,daylight:om.daylight||{},alerts:nws.alerts||[],decision,sourceHealth,sourceErrors,sources:[{id:'usgs',name:'USGS Water Data',live:sourceHealth.usgs,url:`https://waterdata.usgs.gov/monitoring-location/${USGS_SITE}/`},{id:'nws',name:'National Weather Service',live:sourceHealth.nws,url:`https://forecast.weather.gov/MapClick.php?lat=${LAT}&lon=${LON}`},{id:'open-meteo',name:'Open-Meteo fallback / cloud + QPF',live:sourceHealth.openMeteo,url:'https://open-meteo.com/'},{id:'dnr',name:'Michigan DNR park database',live:true,url:'https://www.michigan.gov/recsearch/parks/tahquamenonfalls'}]};
  res.setHeader('Cache-Control','public, s-maxage=300, stale-while-revalidate=900'); return res.status(200).json(payload);
}
