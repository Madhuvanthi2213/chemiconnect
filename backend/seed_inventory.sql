-- ChemiConnect: add a big starter inventory (152 batches, 138 different medicines) to EVERY PHC Pharma account.
-- Every row gets a batch number, an expiry date, a quantity and a price (free essentials = 0).
-- OPTIONAL: the API already does this by itself the first time a PHC Pharma logs in. Use this file only if you
-- want to load the stock straight from phpMyAdmin. Safe to run again: a medicine the pharma already stocks is skipped.
--   phpMyAdmin: Import tab -> choose this file      or CLI:  mysql -u root -p chemiconnect < backend/seed_inventory.sql

USE chemiconnect;

INSERT IGNORE INTO stock (user_id, name, batch_no, expiry_date, qty, price)
SELECT u.id, v.name,
       CONCAT(v.pre, DATE_FORMAT(CURDATE(), '%y'), LPAD(v.idx, 3, '0')),
       LAST_DAY(DATE_ADD(CURDATE(), INTERVAL v.months MONTH)),
       v.qty, v.price
FROM users u
JOIN (
  SELECT 'Paracetamol 500mg Tablet' AS name, 'PCM-' AS pre, 11 AS idx, 400 AS qty, 0 AS price, 22 AS months
  UNION ALL
  SELECT 'Paracetamol 650mg Tablet' AS name, 'PCM-' AS pre, 12 AS idx, 260 AS qty, 0 AS price, 20 AS months
  UNION ALL
  SELECT 'Paracetamol 125mg/5ml Syrup 60ml' AS name, 'PCS-' AS pre, 13 AS idx, 120 AS qty, 0 AS price, 16 AS months
  UNION ALL
  SELECT 'Cetirizine 10mg Tablet' AS name, 'CTZ-' AS pre, 14 AS idx, 250 AS qty, 0 AS price, 20 AS months
  UNION ALL
  SELECT 'Omeprazole 20mg Capsule' AS name, 'OMP-' AS pre, 15 AS idx, 200 AS qty, 0 AS price, 18 AS months
  UNION ALL
  SELECT 'Antacid Suspension 170ml' AS name, 'ANT-' AS pre, 16 AS idx, 90 AS qty, 0 AS price, 15 AS months
  UNION ALL
  SELECT 'Antacid Chewable Tablet' AS name, 'ACT-' AS pre, 17 AS idx, 240 AS qty, 0 AS price, 17 AS months
  UNION ALL
  SELECT 'Amoxicillin 500mg Capsule' AS name, 'AMX-' AS pre, 18 AS idx, 180 AS qty, 0 AS price, 14 AS months
  UNION ALL
  SELECT 'Amoxicillin 250mg Dispersible Tablet' AS name, 'AMD-' AS pre, 19 AS idx, 140 AS qty, 0 AS price, 13 AS months
  UNION ALL
  SELECT 'ORS Sachet 21g' AS name, 'ORS-' AS pre, 20 AS idx, 300 AS qty, 0 AS price, 24 AS months
  UNION ALL
  SELECT 'Zinc 20mg Dispersible Tablet' AS name, 'ZNC-' AS pre, 21 AS idx, 220 AS qty, 0 AS price, 21 AS months
  UNION ALL
  SELECT 'Metformin 500mg Tablet' AS name, 'MET-' AS pre, 22 AS idx, 350 AS qty, 0 AS price, 19 AS months
  UNION ALL
  SELECT 'Metformin 850mg Tablet' AS name, 'MEF-' AS pre, 23 AS idx, 180 AS qty, 0 AS price, 18 AS months
  UNION ALL
  SELECT 'Amlodipine 5mg Tablet' AS name, 'AML-' AS pre, 24 AS idx, 300 AS qty, 0 AS price, 23 AS months
  UNION ALL
  SELECT 'Amlodipine 10mg Tablet' AS name, 'AMT-' AS pre, 25 AS idx, 150 AS qty, 0 AS price, 22 AS months
  UNION ALL
  SELECT 'Salbutamol Inhaler 100mcg' AS name, 'SAL-' AS pre, 26 AS idx, 60 AS qty, 0 AS price, 16 AS months
  UNION ALL
  SELECT 'Salbutamol 2mg Tablet' AS name, 'SLT-' AS pre, 27 AS idx, 110 AS qty, 0 AS price, 19 AS months
  UNION ALL
  SELECT 'Iron Folic Acid Tablet' AS name, 'IFA-' AS pre, 28 AS idx, 500 AS qty, 0 AS price, 25 AS months
  UNION ALL
  SELECT 'Folic Acid 5mg Tablet' AS name, 'FOL-' AS pre, 29 AS idx, 260 AS qty, 0 AS price, 24 AS months
  UNION ALL
  SELECT 'Vitamin A 2000 IU Capsule' AS name, 'VTA-' AS pre, 30 AS idx, 150 AS qty, 0 AS price, 17 AS months
  UNION ALL
  SELECT 'Povidone Iodine 5% Solution 100ml' AS name, 'PVI-' AS pre, 31 AS idx, 70 AS qty, 0 AS price, 26 AS months
  UNION ALL
  SELECT 'Povidone Iodine 10% Ointment 15g' AS name, 'PVO-' AS pre, 32 AS idx, 55 AS qty, 0 AS price, 22 AS months
  UNION ALL
  SELECT 'Clotrimazole 1% Cream 15g' AS name, 'CLO-' AS pre, 33 AS idx, 80 AS qty, 0 AS price, 18 AS months
  UNION ALL
  SELECT 'Albendazole 400mg Tablet' AS name, 'ALB-' AS pre, 34 AS idx, 200 AS qty, 0 AS price, 20 AS months
  UNION ALL
  SELECT 'Albendazole 200mg/5ml Suspension 10ml' AS name, 'ALS-' AS pre, 35 AS idx, 70 AS qty, 0 AS price, 15 AS months
  UNION ALL
  SELECT 'Ibuprofen 400mg Tablet' AS name, 'IBU-' AS pre, 36 AS idx, 150 AS qty, 2.5 AS price, 20 AS months
  UNION ALL
  SELECT 'Ibuprofen 100mg/5ml Suspension 60ml' AS name, 'IBS-' AS pre, 37 AS idx, 60 AS qty, 38 AS price, 15 AS months
  UNION ALL
  SELECT 'Diclofenac 50mg Tablet' AS name, 'DIC-' AS pre, 38 AS idx, 140 AS qty, 3 AS price, 19 AS months
  UNION ALL
  SELECT 'Diclofenac Gel 30g' AS name, 'DGL-' AS pre, 39 AS idx, 60 AS qty, 85 AS price, 17 AS months
  UNION ALL
  SELECT 'Aceclofenac 100mg Tablet' AS name, 'ACL-' AS pre, 40 AS idx, 130 AS qty, 4.5 AS price, 18 AS months
  UNION ALL
  SELECT 'Naproxen 250mg Tablet' AS name, 'NAP-' AS pre, 41 AS idx, 90 AS qty, 5 AS price, 19 AS months
  UNION ALL
  SELECT 'Tramadol 50mg Capsule' AS name, 'TRM-' AS pre, 42 AS idx, 60 AS qty, 6 AS price, 16 AS months
  UNION ALL
  SELECT 'Mefenamic Acid 500mg Tablet' AS name, 'MFA-' AS pre, 43 AS idx, 110 AS qty, 3.5 AS price, 20 AS months
  UNION ALL
  SELECT 'Aspirin 75mg Tablet' AS name, 'ASP-' AS pre, 44 AS idx, 160 AS qty, 2 AS price, 25 AS months
  UNION ALL
  SELECT 'Aspirin 325mg Tablet' AS name, 'AS3-' AS pre, 45 AS idx, 100 AS qty, 2 AS price, 24 AS months
  UNION ALL
  SELECT 'Diclofenac Spray 55g' AS name, 'DSP-' AS pre, 46 AS idx, 35 AS qty, 120 AS price, 14 AS months
  UNION ALL
  SELECT 'Methyl Salicylate Ointment 30g' AS name, 'MSO-' AS pre, 47 AS idx, 45 AS qty, 60 AS price, 18 AS months
  UNION ALL
  SELECT 'Azithromycin 500mg Tablet' AS name, 'AZI-' AS pre, 48 AS idx, 90 AS qty, 18 AS price, 15 AS months
  UNION ALL
  SELECT 'Azithromycin 250mg Tablet' AS name, 'AZT-' AS pre, 49 AS idx, 80 AS qty, 12 AS price, 16 AS months
  UNION ALL
  SELECT 'Ciprofloxacin 500mg Tablet' AS name, 'CIP-' AS pre, 50 AS idx, 100 AS qty, 9 AS price, 16 AS months
  UNION ALL
  SELECT 'Cefixime 200mg Tablet' AS name, 'CEF-' AS pre, 51 AS idx, 80 AS qty, 14 AS price, 14 AS months
  UNION ALL
  SELECT 'Cefpodoxime 200mg Tablet' AS name, 'CPX-' AS pre, 52 AS idx, 70 AS qty, 22 AS price, 15 AS months
  UNION ALL
  SELECT 'Cephalexin 500mg Capsule' AS name, 'CPL-' AS pre, 53 AS idx, 90 AS qty, 10 AS price, 17 AS months
  UNION ALL
  SELECT 'Doxycycline 100mg Capsule' AS name, 'DOX-' AS pre, 54 AS idx, 90 AS qty, 7 AS price, 18 AS months
  UNION ALL
  SELECT 'Metronidazole 400mg Tablet' AS name, 'MTZ-' AS pre, 55 AS idx, 160 AS qty, 2.5 AS price, 21 AS months
  UNION ALL
  SELECT 'Ofloxacin 200mg Tablet' AS name, 'OFX-' AS pre, 56 AS idx, 100 AS qty, 6 AS price, 17 AS months
  UNION ALL
  SELECT 'Norfloxacin 400mg Tablet' AS name, 'NRX-' AS pre, 57 AS idx, 90 AS qty, 5.5 AS price, 18 AS months
  UNION ALL
  SELECT 'Cotrimoxazole 480mg Tablet' AS name, 'COT-' AS pre, 58 AS idx, 140 AS qty, 3 AS price, 22 AS months
  UNION ALL
  SELECT 'Erythromycin 250mg Tablet' AS name, 'ERY-' AS pre, 59 AS idx, 70 AS qty, 8 AS price, 16 AS months
  UNION ALL
  SELECT 'Nitrofurantoin 100mg Capsule' AS name, 'NIT-' AS pre, 60 AS idx, 60 AS qty, 9 AS price, 15 AS months
  UNION ALL
  SELECT 'Fluconazole 150mg Tablet' AS name, 'FLU-' AS pre, 61 AS idx, 50 AS qty, 20 AS price, 18 AS months
  UNION ALL
  SELECT 'Acyclovir 400mg Tablet' AS name, 'ACY-' AS pre, 62 AS idx, 60 AS qty, 12 AS price, 19 AS months
  UNION ALL
  SELECT 'Ivermectin 12mg Tablet' AS name, 'IVM-' AS pre, 63 AS idx, 80 AS qty, 8 AS price, 20 AS months
  UNION ALL
  SELECT 'Mupirocin 2% Ointment 5g' AS name, 'MUP-' AS pre, 64 AS idx, 50 AS qty, 95 AS price, 16 AS months
  UNION ALL
  SELECT 'Framycetin Skin Cream 30g' AS name, 'FRA-' AS pre, 65 AS idx, 40 AS qty, 70 AS price, 17 AS months
  UNION ALL
  SELECT 'Terbinafine 1% Cream 10g' AS name, 'TER-' AS pre, 66 AS idx, 45 AS qty, 85 AS price, 18 AS months
  UNION ALL
  SELECT 'Silver Sulphadiazine 1% Cream 25g' AS name, 'SSD-' AS pre, 67 AS idx, 40 AS qty, 75 AS price, 15 AS months
  UNION ALL
  SELECT 'Gentamicin Eye/Ear Drops 10ml' AS name, 'GEN-' AS pre, 68 AS idx, 50 AS qty, 30 AS price, 14 AS months
  UNION ALL
  SELECT 'Ciprofloxacin Eye Drops 5ml' AS name, 'CEY-' AS pre, 69 AS idx, 55 AS qty, 32 AS price, 13 AS months
  UNION ALL
  SELECT 'Pantoprazole 40mg Tablet' AS name, 'PAN-' AS pre, 70 AS idx, 160 AS qty, 6 AS price, 21 AS months
  UNION ALL
  SELECT 'Ranitidine 150mg Tablet' AS name, 'RAN-' AS pre, 71 AS idx, 120 AS qty, 2.5 AS price, 17 AS months
  UNION ALL
  SELECT 'Rabeprazole 20mg Tablet' AS name, 'RAB-' AS pre, 72 AS idx, 110 AS qty, 7 AS price, 20 AS months
  UNION ALL
  SELECT 'Domperidone 10mg Tablet' AS name, 'DOM-' AS pre, 73 AS idx, 150 AS qty, 3 AS price, 19 AS months
  UNION ALL
  SELECT 'Ondansetron 4mg Tablet' AS name, 'OND-' AS pre, 74 AS idx, 90 AS qty, 5 AS price, 15 AS months
  UNION ALL
  SELECT 'Loperamide 2mg Capsule' AS name, 'LOP-' AS pre, 75 AS idx, 80 AS qty, 3.5 AS price, 16 AS months
  UNION ALL
  SELECT 'Dicyclomine 10mg Tablet' AS name, 'DCY-' AS pre, 76 AS idx, 120 AS qty, 3 AS price, 18 AS months
  UNION ALL
  SELECT 'Lactulose Syrup 100ml' AS name, 'LAC-' AS pre, 77 AS idx, 50 AS qty, 110 AS price, 16 AS months
  UNION ALL
  SELECT 'Bisacodyl 5mg Tablet' AS name, 'BIS-' AS pre, 78 AS idx, 100 AS qty, 2.5 AS price, 22 AS months
  UNION ALL
  SELECT 'Simethicone 40mg Tablet' AS name, 'SIM-' AS pre, 79 AS idx, 100 AS qty, 2 AS price, 20 AS months
  UNION ALL
  SELECT 'Racecadotril 100mg Capsule' AS name, 'RCD-' AS pre, 80 AS idx, 50 AS qty, 25 AS price, 15 AS months
  UNION ALL
  SELECT 'Probiotic Sachet' AS name, 'PRB-' AS pre, 81 AS idx, 90 AS qty, 12 AS price, 12 AS months
  UNION ALL
  SELECT 'Levocetirizine 5mg Tablet' AS name, 'LEV-' AS pre, 82 AS idx, 130 AS qty, 4 AS price, 22 AS months
  UNION ALL
  SELECT 'Montelukast 10mg Tablet' AS name, 'MON-' AS pre, 83 AS idx, 100 AS qty, 12 AS price, 17 AS months
  UNION ALL
  SELECT 'Chlorpheniramine 4mg Tablet' AS name, 'CPM-' AS pre, 84 AS idx, 200 AS qty, 1 AS price, 24 AS months
  UNION ALL
  SELECT 'Fexofenadine 120mg Tablet' AS name, 'FEX-' AS pre, 85 AS idx, 90 AS qty, 9 AS price, 19 AS months
  UNION ALL
  SELECT 'Cough Syrup 100ml' AS name, 'CSY-' AS pre, 86 AS idx, 70 AS qty, 55 AS price, 14 AS months
  UNION ALL
  SELECT 'Ambroxol Syrup 100ml' AS name, 'AMB-' AS pre, 87 AS idx, 60 AS qty, 48 AS price, 16 AS months
  UNION ALL
  SELECT 'Dextromethorphan Cough Syrup 100ml' AS name, 'DXM-' AS pre, 88 AS idx, 55 AS qty, 52 AS price, 15 AS months
  UNION ALL
  SELECT 'Budesonide Inhaler 200mcg' AS name, 'BUD-' AS pre, 89 AS idx, 30 AS qty, 260 AS price, 18 AS months
  UNION ALL
  SELECT 'Ipratropium Inhaler 20mcg' AS name, 'IPR-' AS pre, 90 AS idx, 30 AS qty, 230 AS price, 17 AS months
  UNION ALL
  SELECT 'Theophylline 200mg Tablet' AS name, 'THE-' AS pre, 91 AS idx, 70 AS qty, 5 AS price, 20 AS months
  UNION ALL
  SELECT 'Xylometazoline Nasal Drops 10ml' AS name, 'XYL-' AS pre, 92 AS idx, 50 AS qty, 42 AS price, 15 AS months
  UNION ALL
  SELECT 'Saline Nasal Drops 10ml' AS name, 'SNS-' AS pre, 93 AS idx, 60 AS qty, 35 AS price, 20 AS months
  UNION ALL
  SELECT 'Prednisolone 5mg Tablet' AS name, 'PRD-' AS pre, 94 AS idx, 150 AS qty, 2 AS price, 21 AS months
  UNION ALL
  SELECT 'Prednisolone 20mg Tablet' AS name, 'PR2-' AS pre, 95 AS idx, 70 AS qty, 5 AS price, 20 AS months
  UNION ALL
  SELECT 'Dexamethasone 0.5mg Tablet' AS name, 'DEX-' AS pre, 96 AS idx, 90 AS qty, 1.5 AS price, 23 AS months
  UNION ALL
  SELECT 'Atorvastatin 10mg Tablet' AS name, 'ATO-' AS pre, 97 AS idx, 140 AS qty, 8 AS price, 24 AS months
  UNION ALL
  SELECT 'Atorvastatin 20mg Tablet' AS name, 'AT2-' AS pre, 98 AS idx, 110 AS qty, 12 AS price, 23 AS months
  UNION ALL
  SELECT 'Losartan 50mg Tablet' AS name, 'LOS-' AS pre, 99 AS idx, 130 AS qty, 6.5 AS price, 23 AS months
  UNION ALL
  SELECT 'Atenolol 50mg Tablet' AS name, 'ATE-' AS pre, 100 AS idx, 120 AS qty, 4.5 AS price, 22 AS months
  UNION ALL
  SELECT 'Telmisartan 40mg Tablet' AS name, 'TEL-' AS pre, 101 AS idx, 120 AS qty, 8 AS price, 21 AS months
  UNION ALL
  SELECT 'Enalapril 5mg Tablet' AS name, 'ENA-' AS pre, 102 AS idx, 100 AS qty, 3 AS price, 22 AS months
  UNION ALL
  SELECT 'Metoprolol 50mg Tablet' AS name, 'MTP-' AS pre, 103 AS idx, 110 AS qty, 5 AS price, 21 AS months
  UNION ALL
  SELECT 'Hydrochlorothiazide 12.5mg Tablet' AS name, 'HCT-' AS pre, 104 AS idx, 100 AS qty, 2.5 AS price, 24 AS months
  UNION ALL
  SELECT 'Furosemide 40mg Tablet' AS name, 'FUR-' AS pre, 105 AS idx, 100 AS qty, 2 AS price, 23 AS months
  UNION ALL
  SELECT 'Clopidogrel 75mg Tablet' AS name, 'CLP-' AS pre, 106 AS idx, 90 AS qty, 9 AS price, 22 AS months
  UNION ALL
  SELECT 'Isosorbide Mononitrate 20mg Tablet' AS name, 'ISM-' AS pre, 107 AS idx, 80 AS qty, 6 AS price, 20 AS months
  UNION ALL
  SELECT 'Sorbitrate 5mg Tablet' AS name, 'SOR-' AS pre, 108 AS idx, 80 AS qty, 3 AS price, 19 AS months
  UNION ALL
  SELECT 'Glimepiride 2mg Tablet' AS name, 'GLM-' AS pre, 109 AS idx, 110 AS qty, 7.5 AS price, 20 AS months
  UNION ALL
  SELECT 'Glibenclamide 5mg Tablet' AS name, 'GLB-' AS pre, 110 AS idx, 130 AS qty, 2 AS price, 21 AS months
  UNION ALL
  SELECT 'Gliclazide 80mg Tablet' AS name, 'GLC-' AS pre, 111 AS idx, 100 AS qty, 5 AS price, 20 AS months
  UNION ALL
  SELECT 'Insulin Regular 40IU Vial 10ml' AS name, 'INS-' AS pre, 112 AS idx, 25 AS qty, 160 AS price, 9 AS months
  UNION ALL
  SELECT 'Rosuvastatin 10mg Tablet' AS name, 'ROS-' AS pre, 113 AS idx, 90 AS qty, 14 AS price, 22 AS months
  UNION ALL
  SELECT 'Phenytoin 100mg Tablet' AS name, 'PHT-' AS pre, 114 AS idx, 80 AS qty, 3 AS price, 20 AS months
  UNION ALL
  SELECT 'Carbamazepine 200mg Tablet' AS name, 'CBZ-' AS pre, 115 AS idx, 70 AS qty, 4 AS price, 19 AS months
  UNION ALL
  SELECT 'Amitriptyline 25mg Tablet' AS name, 'AMI-' AS pre, 116 AS idx, 80 AS qty, 2.5 AS price, 21 AS months
  UNION ALL
  SELECT 'Gabapentin 300mg Capsule' AS name, 'GAB-' AS pre, 117 AS idx, 70 AS qty, 10 AS price, 18 AS months
  UNION ALL
  SELECT 'Diazepam 5mg Tablet' AS name, 'DZP-' AS pre, 118 AS idx, 40 AS qty, 3 AS price, 16 AS months
  UNION ALL
  SELECT 'Betahistine 16mg Tablet' AS name, 'BET-' AS pre, 119 AS idx, 60 AS qty, 9 AS price, 17 AS months
  UNION ALL
  SELECT 'Promethazine 25mg Tablet' AS name, 'PMZ-' AS pre, 120 AS idx, 80 AS qty, 3 AS price, 19 AS months
  UNION ALL
  SELECT 'Cinnarizine 25mg Tablet' AS name, 'CNZ-' AS pre, 121 AS idx, 90 AS qty, 3.5 AS price, 18 AS months
  UNION ALL
  SELECT 'Vitamin B Complex Tablet' AS name, 'VBC-' AS pre, 122 AS idx, 200 AS qty, 2 AS price, 18 AS months
  UNION ALL
  SELECT 'Vitamin C 500mg Chewable Tablet' AS name, 'VTC-' AS pre, 123 AS idx, 180 AS qty, 2.5 AS price, 19 AS months
  UNION ALL
  SELECT 'Calcium D3 Tablet' AS name, 'CAL-' AS pre, 124 AS idx, 150 AS qty, 5 AS price, 21 AS months
  UNION ALL
  SELECT 'Vitamin D3 60000 IU Sachet' AS name, 'VD3-' AS pre, 125 AS idx, 100 AS qty, 18 AS price, 18 AS months
  UNION ALL
  SELECT 'Multivitamin Tablet' AS name, 'MVT-' AS pre, 126 AS idx, 160 AS qty, 3 AS price, 20 AS months
  UNION ALL
  SELECT 'Vitamin B12 Methylcobalamin 1500mcg Tablet' AS name, 'B12-' AS pre, 127 AS idx, 100 AS qty, 6 AS price, 19 AS months
  UNION ALL
  SELECT 'Hydrocortisone 1% Cream 15g' AS name, 'HYD-' AS pre, 128 AS idx, 60 AS qty, 45 AS price, 18 AS months
  UNION ALL
  SELECT 'Betamethasone 0.05% Cream 15g' AS name, 'BTM-' AS pre, 129 AS idx, 50 AS qty, 55 AS price, 17 AS months
  UNION ALL
  SELECT 'Calamine Lotion 100ml' AS name, 'CLM-' AS pre, 130 AS idx, 60 AS qty, 40 AS price, 20 AS months
  UNION ALL
  SELECT 'Permethrin 5% Lotion 30ml' AS name, 'PER-' AS pre, 131 AS idx, 40 AS qty, 90 AS price, 17 AS months
  UNION ALL
  SELECT 'Benzyl Benzoate Lotion 100ml' AS name, 'BBL-' AS pre, 132 AS idx, 45 AS qty, 50 AS price, 16 AS months
  UNION ALL
  SELECT 'Gentian Violet Paint 15ml' AS name, 'GVP-' AS pre, 133 AS idx, 50 AS qty, 20 AS price, 22 AS months
  UNION ALL
  SELECT 'Chlorhexidine 0.2% Mouthwash 100ml' AS name, 'CHX-' AS pre, 134 AS idx, 50 AS qty, 45 AS price, 18 AS months
  UNION ALL
  SELECT 'Hydrogen Peroxide 6% Solution 100ml' AS name, 'HPX-' AS pre, 135 AS idx, 50 AS qty, 25 AS price, 20 AS months
  UNION ALL
  SELECT 'Surgical Spirit 100ml' AS name, 'SSP-' AS pre, 136 AS idx, 60 AS qty, 30 AS price, 24 AS months
  UNION ALL
  SELECT 'Cotton Roll 100g' AS name, 'CTR-' AS pre, 137 AS idx, 80 AS qty, 40 AS price, 36 AS months
  UNION ALL
  SELECT 'Crepe Bandage 6cm' AS name, 'CRB-' AS pre, 138 AS idx, 70 AS qty, 35 AS price, 36 AS months
  UNION ALL
  SELECT 'Adhesive Plaster 2.5cm' AS name, 'ADP-' AS pre, 139 AS idx, 90 AS qty, 28 AS price, 30 AS months
  UNION ALL
  SELECT 'Disposable Gloves (Box of 100)' AS name, 'GLV-' AS pre, 140 AS idx, 30 AS qty, 260 AS price, 30 AS months
  UNION ALL
  SELECT 'Disposable Syringe 5ml (Box of 100)' AS name, 'SYR-' AS pre, 141 AS idx, 25 AS qty, 350 AS price, 30 AS months
  UNION ALL
  SELECT 'Normal Saline 0.9% IV 500ml' AS name, 'NSL-' AS pre, 142 AS idx, 60 AS qty, 38 AS price, 18 AS months
  UNION ALL
  SELECT 'Ringer Lactate IV 500ml' AS name, 'RLI-' AS pre, 143 AS idx, 50 AS qty, 42 AS price, 18 AS months
  UNION ALL
  SELECT 'Dextrose 5% IV 500ml' AS name, 'DNS-' AS pre, 144 AS idx, 50 AS qty, 40 AS price, 18 AS months
  UNION ALL
  SELECT 'Glucometer Test Strips (50)' AS name, 'GTS-' AS pre, 145 AS idx, 30 AS qty, 450 AS price, 12 AS months
  UNION ALL
  SELECT 'Pregnancy Test Kit' AS name, 'PTK-' AS pre, 146 AS idx, 60 AS qty, 35 AS price, 18 AS months
  UNION ALL
  SELECT 'Tetanus Toxoid 0.5ml Vial' AS name, 'TTV-' AS pre, 147 AS idx, 40 AS qty, 18 AS price, 10 AS months
  UNION ALL
  SELECT 'Oxytocin 5IU Injection' AS name, 'OXY-' AS pre, 148 AS idx, 30 AS qty, 28 AS price, 9 AS months
  UNION ALL
  SELECT 'Paracetamol 500mg Tablet' AS name, 'PCM-' AS pre, 149 AS idx, 150 AS qty, 0 AS price, 9 AS months
  UNION ALL
  SELECT 'ORS Sachet 21g' AS name, 'ORS-' AS pre, 150 AS idx, 120 AS qty, 0 AS price, 10 AS months
  UNION ALL
  SELECT 'Metformin 500mg Tablet' AS name, 'MET-' AS pre, 151 AS idx, 100 AS qty, 0 AS price, 8 AS months
  UNION ALL
  SELECT 'Amoxicillin 500mg Capsule' AS name, 'AMX-' AS pre, 152 AS idx, 60 AS qty, 0 AS price, 7 AS months
  UNION ALL
  SELECT 'Pantoprazole 40mg Tablet' AS name, 'PAN-' AS pre, 153 AS idx, 50 AS qty, 6 AS price, 8 AS months
  UNION ALL
  SELECT 'Azithromycin 500mg Tablet' AS name, 'AZI-' AS pre, 154 AS idx, 30 AS qty, 18 AS price, 6 AS months
  UNION ALL
  SELECT 'Atorvastatin 10mg Tablet' AS name, 'ATO-' AS pre, 155 AS idx, 40 AS qty, 8 AS price, 10 AS months
  UNION ALL
  SELECT 'Cetirizine 10mg Tablet' AS name, 'CTZ-' AS pre, 156 AS idx, 80 AS qty, 0 AS price, 9 AS months
  UNION ALL
  SELECT 'Cough Syrup 100ml' AS name, 'CSY-' AS pre, 157 AS idx, 15 AS qty, 55 AS price, 0 AS months
  UNION ALL
  SELECT 'Vitamin B Complex Tablet' AS name, 'VBC-' AS pre, 158 AS idx, 40 AS qty, 2 AS price, 0 AS months
  UNION ALL
  SELECT 'Ciprofloxacin Eye Drops 5ml' AS name, 'CEY-' AS pre, 159 AS idx, 12 AS qty, 32 AS price, 0 AS months
  UNION ALL
  SELECT 'Diazepam 5mg Tablet' AS name, 'DZP-' AS pre, 160 AS idx, 3 AS qty, 3 AS price, 12 AS months
  UNION ALL
  SELECT 'Insulin Regular 40IU Vial 10ml' AS name, 'INS-' AS pre, 161 AS idx, 2 AS qty, 160 AS price, 8 AS months
  UNION ALL
  SELECT 'Oxytocin 5IU Injection' AS name, 'OXY-' AS pre, 162 AS idx, 3 AS qty, 28 AS price, 7 AS months
) v
WHERE u.role = 'pharmacy'
  AND NOT EXISTS (SELECT 1 FROM stock s WHERE s.user_id = u.id AND LOWER(s.name) = LOWER(v.name)
                  AND s.batch_no <> CONCAT(v.pre, DATE_FORMAT(CURDATE(), '%y'), LPAD(v.idx, 3, '0')));

-- check
SELECT u.name AS pharma, COUNT(*) AS batches, SUM(s.qty) AS units FROM stock s JOIN users u ON u.id = s.user_id WHERE u.role = 'pharmacy' GROUP BY u.id;
