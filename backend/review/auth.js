'use strict';
const crypto=require('node:crypto');
const {promisify}=require('node:util');
const scrypt=promisify(crypto.scrypt);
async function passwordHash(password,salt){return (await scrypt(password,salt,64)).toString('hex');}
async function createUser(username,role,password){const salt=crypto.randomBytes(16).toString('hex');return {id:'review-'+username,username,role,salt,hash:await passwordHash(password,salt)};}
async function verify(user,password){const candidate=await passwordHash(password,user?.salt??'review-dummy-salt');return !!user&&crypto.timingSafeEqual(Buffer.from(candidate,'hex'),Buffer.from(user.hash,'hex'));}
module.exports={createUser,verify};
