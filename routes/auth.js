import { Router } from "express";
import mongoose from "mongoose";
import { userModel } from "../models/user.js";

const authRouter = Router();

//Sign up
authRouter.post("/signup",(req,res) => {
    const {email,password,firstName,lastName} = req.body;
    res.json("IN signup page");
});

export {authRouter};