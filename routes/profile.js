import { Router } from "express";
import { eprofileModel } from "../models/emergency_profile.js";
import { authUser } from "../middlewares/authMiddleware.js";
import { v4 as uuidv4 } from 'uuid';
import {z} from "zod";

const profileRouter = Router();

//Create Emergency Profile
profileRouter.post("/create",authUser,(req,res) => {
    const schema = z.object({
        bloodtype: z.string(),
        allergies: z.array(z.string()),
        emergencyContact: z.array(z.object({
            phone: z.string(),
            name: z.string(),
            relation: z.string()
        })),
        medicalCondition: z.array(z.string()),
        medications: z.array(z.string()),
    });

    const result = schema.safeParse(req.body);
    
    if(!result.success){
        return res.status(404).json({
            msg: "Error",
            error: result
        });
    }
    
    const {bloodtype,allergies,emergencyContact,medicalCondition,medications} = req.body;
    const usedId = req.userId;
    const qrcodeToken = uuidv4();//random string , doesn't repreat


});

export {profileRouter};