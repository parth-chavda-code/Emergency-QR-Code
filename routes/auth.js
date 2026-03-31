import { Router } from "express";
import mongoose from "mongoose";
import { userModel } from "../models/user.js";
import { z } from "zod";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const authRouter = Router();

//Sign up
authRouter.post("/signup",async (req,res) => {
    //Zod schema
    const schema = z.object({
        email: z.email("Invalid email"),
        password: z.string(),
        firstName: z.string(),
        lastName: z.string()
    });
    //Zod result
    const zodRes = schema.safeParse(req.body);
    //Zod Check
    if(!zodRes.success){
        return res.status(404).json({
            msg: "Error in signup req body",
            error: zodRes
        });
    }

    const {email,password,firstName,lastName} = req.body;
    //find dubplicate user
    const userFind = await userModel.findOne({
        email:email
    });

    if(userFind){
        return res.status(404).json({
            msg: "User is alreay exist"
        });
    }
    // if(userFind){

    // }
    //Password hashing
    try{
        const saltround = 10;
        const hashedPassword = await bcrypt.hash(password,saltround);
        
        //DB insertion
        await userModel.create({
            email: email,
            password: hashedPassword,
            firstName: firstName,
            lastName: lastName
        });

        res.json({
            msg: "Work Just OK"
        });

    } catch(err){
        return res.status(404).json({
            msg: "Error in db insertion",
            error: err
        });
    }
    

});
//Log in
authRouter.post("/login",(req,res) => {
    //Zod Schema
    const schema = z.object({
        email: z.email("Invalid Email"),
        password: z.string()
    });
    //Zod Result
    const zodRes = schema.safeParse(req.body);
    if(!zodRes.success){
        return res.status(404).json({
            msg: "Invalid Format",
            zodError: zodRes
        });
    }

    const {email,password} = req.body;
    //
    //JWT Token
    try {
        
    } catch (err) {
        
    }



});
export {authRouter};