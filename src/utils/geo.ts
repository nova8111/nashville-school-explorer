export const EARTH_RADIUS_MILES = 3958.8;
export function haversineMiles(a:{lat:number;lon:number},b:{lat:number;lon:number}) { const rad=(n:number)=>n*Math.PI/180; const dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon); const x=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2; return 2*EARTH_RADIUS_MILES*Math.asin(Math.sqrt(x)); }
