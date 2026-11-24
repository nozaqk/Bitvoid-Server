import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
const secret=()=>process.env.JWT_SECRET;
export async function hashPassword(password){return bcrypt.hash(password,12);}
export async function verifyPassword(password,hash){return bcrypt.compare(password,hash);}
export function issueToken(user){if(!secret())throw new Error("JWT_SECRET is not configured");return jwt.sign({sub:user.id,username:user.username},secret(),{expiresIn:"14d",issuer:"bitvoid-cloud"});}
export function authenticate(request,reply){
 const header=request.headers.authorization||"";const token=header.startsWith("Bearer ")?header.slice(7):"";
 try{request.user=jwt.verify(token,secret(),{issuer:"bitvoid-cloud"});return true;}
 catch{reply.code(401).send({error:"unauthorized",message:"A valid session token is required"});return false;}
}
