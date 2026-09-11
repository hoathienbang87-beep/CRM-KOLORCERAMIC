import {divideInteger,multiplyIntegerByDecimal} from "./exact-decimal.js";
import {normalizeCode} from "./normalization.js";

export function validatePriceMath(row,{toleranceVnd=1n}={}){
  if(!row.price_per_m2||!row.price_per_box||!row.price_per_piece||!row.pieces_per_box||!row.sqm_per_box) return {status:"NOT_ENOUGH_DATA"};
  const box=multiplyIntegerByDecimal(row.price_per_m2,row.sqm_per_box);
  const piece=divideInteger(row.price_per_box,row.pieces_per_box);
  if(!box?.exact||!piece?.exact) return {status:"MISMATCH",calculated_box:box?.value?.toString()||null,calculated_piece:piece?.value?.toString()||null};
  const sourceBox=BigInt(row.price_per_box),sourcePiece=BigInt(row.price_per_piece);
  const boxDiff=box.value-sourceBox,pieceDiff=piece.value-sourcePiece;
  const abs=value=>value<0n?-value:value;
  const status=boxDiff===0n&&pieceDiff===0n?"EXACT":abs(boxDiff)<=toleranceVnd&&abs(pieceDiff)<=toleranceVnd?"WITHIN_TOLERANCE":"MISMATCH";
  return {status,calculated_box:box.value.toString(),source_box:row.price_per_box,box_diff:boxDiff.toString(),calculated_piece:piece.value.toString(),source_piece:row.price_per_piece,piece_diff:pieceDiff.toString()};
}

export function validateRequired(row){
  return ["code","name","width_cm","height_cm","price_per_m2"].filter(field=>!row[field]);
}

export function validateCode(value){
  const code=normalizeCode(value);
  return Boolean(code)&&code.length<=120&&!/[\u0000-\u001f\u007f]/u.test(code);
}
