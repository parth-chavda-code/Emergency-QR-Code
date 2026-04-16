import { Router } from "express";
import { userModel } from "../models/user.js";
import { z } from "zod";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const userRouter = Router();

//Sign up
userRouter.post("/signup",async (req,res) => {
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
            msg: "User is registered successfully"
        });

    } catch(err){
        return res.status(404).json({
            msg: "Error in db insertion",
            error: err
        });
    }
    

});
//Log in
userRouter.post("/login",async (req,res) => {
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
    //user registration check
    const checkUser = await userModel.findOne({
        email: email
    });

    if(!checkUser){
        return res.status(404).json({
            msg: "User is not registered"
        });
    }

    //password checking
    const hashedPass = checkUser.password;
    const checkPass = await bcrypt.compare(password,hashedPass);
    if(!checkPass){
        return res.status(404).json({
            msg: "Wrong Password"
        });
    }

    //JWT Token
    try {
        const token = jwt.sign(
            {id: checkUser._id},
            process.env.JWT_SECRET,
            {expiresIn: "2h"}
        );
        res.json({
            msg: "User is Loged in Successfully",
            token: token
        });

    } catch (err) {
        res.json({
            msg: "Login Error"
        });
    }



});
export {userRouter};