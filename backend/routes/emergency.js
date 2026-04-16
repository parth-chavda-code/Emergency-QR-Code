import { Router } from "express";
import { eprofileModel } from "../models/emergency_profile.js";

const eRouter = Router();

eRouter.get("/:qrtoken",async (req,res) => {
    const { qrtoken } = req.params;

    try {
        const result = await eprofileModel.findOne({
            qrcodeToken: qrtoken
        });
        
        res.json(result);

    } catch (err) {
        return res.json("Error in getting emergency details");
    }
    

});

export {eRouter};