import { Router } from "express";
import { eprofileModel } from "../models/emergency_profile.js";
import { authUser } from "../middlewares/authMiddleware.js";

const profileRouter = Router();

//Create Emergency Profile
profileRouter.post("/create",authUser,(req,res) => {
    res.json("IN profile router");
});

export {profileRouter};