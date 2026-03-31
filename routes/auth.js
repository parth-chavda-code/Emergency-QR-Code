import { Router } from "express";
import mongoose from "mongoose";
import { userModel } from "../models/user.js";
import { z } from zod;

const authRouter = Router();

//Sign up
authRouter.post("/signup",(req,res) => {
    const schema = z.object({
        email: z.email("Invalid email"),
        password: z.string(),
        firstNameL: z.string(),
        lastName: z.string()
    });
    const zodRes = schema.safeParse(req.body);
    if(!zodRes.success){
        return res.status(404).json({
            msg: "Error in signup req body"
        });
    }
    const {email,password,firstName,lastName} = req.body;


});

export {authRouter};