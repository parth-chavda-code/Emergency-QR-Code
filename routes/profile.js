import { Router } from "express";
import { eprofileModel } from "../models/emergency_profile.js";
import { authUser } from "../middlewares/authMiddleware.js";
import { v4 as uuidv4 } from 'uuid';
import {z} from "zod";

const profileRouter = Router();

//Create Emergency Profile
profileRouter.post("/create",authUser,async(req,res) => {
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

    const {bloodType,allergies,emergencyContact,medicalCondition,medications} = req.body;
    const userId = req.userId;
    const qrcodeToken = uuidv4();//random string , doesn't repreat

    try{
        await eprofileModel.create({
            userId: userId,
            bloodType: bloodType,
            allergies: allergies,
            emergencyContact: emergencyContact,
            medicalCondition: medicalCondition,
            medications: medications,
            qrcodeToken: qrcodeToken
        });
        res.json("Done in profile");

    } catch(err){
        res.json("ERROR : ",err);
    }
    
});

//Emergency Profile Update
profileRouter.put("/update",authUser,async(req,res)=>{

    const schema = z.object({
        bloodType: z.string(),
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
        return res.json("Error in profile update zod");
    }

    const uid = req.userId;
    const {bloodType,allergies,emergencyContact,medicalCondition,medications} = req.body

    try {
        await eprofileModel.findOneAndUpdate(
            { userId: uid },
            {  bloodType,allergies,emergencyContact,medicalCondition,medications }
        );
        
        res.json("Update Done");

    } catch (err) {
        res.json("Error in Updating");
    }
});

//Emergency QR CODE

export {profileRouter};