import { Router } from "express";
import mongoose from "mongoose";
import { userModel } from "../models/user.js";
import { z } from "zod";
import bcrypt from "bcrypt";

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
    const {email,password} = req.body;
});
export {authRouter};