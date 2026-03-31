import { Router } from "express";
import mongoose from "mongoose";
import { userModel } from "../models/user.js";

const userRouter = Router();

//Sign up
userRouter.post("/signup",(req,res) => {
    const {email,password,firstName,lastName} = req.body;
    res.json("IN signup page");
});

export {userRouter};