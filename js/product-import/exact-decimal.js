function pow10(n){return 10n ** BigInt(n);}

export function parseExactDecimal(value,{allowZero=false,maxScale=6}={}){
  const source=String(value??"").trim().replace(",", ".");
  const match=/^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(source);
  if(!match||((match[2]?.length||0)>maxScale)) return null;
  const scale=match[2]?.length||0;
  const units=BigInt(match[1]+(match[2]||""));
  if(units<0n||(!allowZero&&units===0n)) return null;
  return {units,scale,text:formatExactDecimal(units,scale)};
}

export function formatExactDecimal(units,scale){
  const negative=units<0n;
  let digits=(negative?-units:units).toString();
  if(scale===0) return `${negative?"-":""}${digits}`;
  digits=digits.padStart(scale+1,"0");
  const whole=digits.slice(0,-scale);
  const fraction=digits.slice(-scale).replace(/0+$/,"");
  return `${negative?"-":""}${whole}${fraction?`.${fraction}`:""}`;
}

export function multiplyIntegerByDecimal(integerText,decimalText){
  if(!/^\d+$/.test(String(integerText))) return null;
  const decimal=parseExactDecimal(decimalText,{allowZero:true,maxScale:9});
  if(!decimal) return null;
  const numerator=BigInt(integerText)*decimal.units;
  const denominator=pow10(decimal.scale);
  return {numerator,denominator,exact:numerator%denominator===0n,value:numerator/denominator};
}

export function divideInteger(integerText,divisorText){
  if(!/^\d+$/.test(String(integerText))||!/^\d+$/.test(String(divisorText))) return null;
  const numerator=BigInt(integerText),denominator=BigInt(divisorText);
  if(denominator===0n) return null;
  return {numerator,denominator,exact:numerator%denominator===0n,value:numerator/denominator};
}
