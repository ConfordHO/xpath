# OLYVIA LIMS User Guide

Version: 2026-08-27

Product: OLYVIA Lab Information Management System

Organization: X.PATH Labs

Partner: [Buntu Labs Technologies](https://www.buntulabs.com)

## How to Use This Guide

This guide is written for both first-time users and daily staff users. If you are new to OLYVIA, read sections 1 to 4 first. After that, go directly to the section for your role.

| User Type | Main Sections to Read |
| --- | --- |
| Patient or public user | Sections 1 to 5, then 17 |
| Referring clinician or doctor | Sections 1 to 4, 6, 14, 17 |
| Receptionist | Sections 1 to 4, 7, 14, 15, 16, 17 |
| Courier | Sections 1 to 4, 8, 14, 16, 17 |
| Laboratory technician | Sections 1 to 4, 9, 14, 15, 16, 17 |
| Pathologist | Sections 1 to 4, 10, 14, 15, 16, 17 |
| Finance user | Sections 1 to 4, 11, 14, 16, 17 |
| Administrator | Sections 1 to 4, 12, 14, 16, 17 |
| Super-admin | Sections 1 to 4, 12, 13, 14, 16, 17 |

## 1. What OLYVIA Is

OLYVIA is a Lab Information Management System (LIMS) developed by X.PATH Labs in partnership with Buntu Labs Technologies. X.PATH Labs is a center for molecular pathology and genomics in Yaounde, Cameroon. Buntu Labs Technologies is a software and systems development firm based in Nairobi, Kenya.

OLYVIA helps a laboratory manage the full life cycle of a case, from the moment a patient or clinician requests a test, through sample pickup, accessioning, laboratory processing, pathology reporting, quality control, release of results, payment tracking, and final record keeping.

The system is designed for multiple users:

- Patients and public users
- Referring clinicians and doctors
- Receptionists
- Couriers
- Laboratory technicians
- Pathologists
- Finance users
- Administrators
- Super-admins

Each user sees the parts of the system that match their role.

## 2. Key Ideas Everyone Should Understand

### 2.1 Orders and Cases

An order is the request for laboratory work. It contains the patient details, requested tests, sample information, payment information, and reporting information.

A case is the laboratory and reporting work connected to an order. In many screens, people may say "order" and "case" to mean the same patient request.

### 2.2 Order Numbers and Accessions

OLYVIA uses unique identifiers so that samples and reports can be tracked safely.

- Order number: looks like `ORD-######`. This is usually used by patients, reception, finance, and support.
- Accession number: looks like `XP-YY-######`. This is the laboratory tracking number.
- Block ID: used for tissue blocks.
- Slide ID: used for prepared slides.

Always use the correct identifier when communicating about a case.

### 2.3 Role-Based Access

Your role controls what you can see and do.

- A receptionist can create orders and manage intake.
- A technician can process samples and update laboratory workflow steps.
- A pathologist can draft and review reports.
- Finance users can record payments and manage financial clearance.
- Admins can manage users, doctors, tests, workflow templates, and settings.
- Super-admins have the highest level of access and can manage the whole system.

If a menu item is missing, it usually means your user role does not have access to that area.

### 2.4 Language

OLYVIA supports English and French. In Cameroon, the system may automatically open in French based on location. You can still use the language toggle to switch between English and French. Your selected language should remain active for future visits on the same browser.

In countries where the system cannot detect English or French as an official language, OLYVIA defaults to English.

### 2.5 Security and Privacy

OLYVIA contains sensitive patient and laboratory data. Use it carefully.

- Do not share your password.
- Lock your screen when stepping away.
- Confirm patient identity before discussing results.
- Do not download or send reports unless you are authorized.
- Use comments and notes professionally because they may become part of the audit history.
- Report suspicious activity to an administrator or super-admin.

## 3. First Steps for All Staff Users

### 3.1 Open OLYVIA

Open the OLYVIA website in your browser:

`https://olyvia.xpath-labs.com`

Use a modern browser such as Chrome, Edge, Safari, or Firefox.

### 3.2 Log In

1. Open the login page.
2. Enter your email address.
3. Enter your password.
4. Use the eye icon in the password field if you need to show or hide the password while typing.
5. Select the correct portal if you are given a choice.
6. Click the login button.

If login succeeds, you will be taken to your dashboard.

### 3.3 Log Out

Always log out when using a shared or public computer.

1. Open the account or profile area.
2. Choose logout.
3. Confirm that you are returned to the public or login screen.

### 3.4 If Your Account Is Locked

An account may be locked after repeated failed login attempts. Contact a super-admin. A super-admin can unlock accounts from the user management area.

### 3.5 If You Forgot Your Password

Contact an administrator or super-admin. They can reset your password or create a temporary password according to your organization policy.

## 4. Understanding Statuses

OLYVIA uses statuses to show where each order or case is in the workflow.

### 4.1 Reporting Traffic-Light Status

Pathology reporting uses a traffic-light quality-control system.

| Color | Meaning | What Happens |
| --- | --- | --- |
| Red | Report not completed or still in progress | The reporting pathologist is still drafting or editing. The report cannot be released. |
| Yellow | Report completed but pending second-pathologist review | A second pathologist must review the report before release. |
| Green | Report reviewed, finalized, and ready for release | The report has passed quality control and can be sent out by authorized users. |

No final pathology report should be sent out while the case is red or yellow.

### 4.2 Financial Clearance

Financial clearance shows whether payment is complete enough for the order to continue or for results to be released, depending on laboratory policy.

Common states include:

- Pending: payment has not been confirmed.
- Partial: some payment has been made, but a balance remains.
- Cleared: the required payment has been confirmed.

### 4.3 Courier Status

Courier status tracks movement of samples from the patient, clinic, or referring site to the laboratory.

Common states include:

- Ready for pickup
- On the way to pickup
- At site for pickup
- Picked up and on the way to lab
- In transit
- Received at lab

### 4.4 Technical Workflow Status

Technical workflow status shows the progress of sample processing. For histology, this may include grossing, processing, embedding, sectioning, staining, and ready for review.

## 5. Guide for Patients and Public Users

Patients and public users can request testing, follow their order, and view released reports when available.

### 5.1 Request a Test Online

1. Open the OLYVIA public website.
2. Choose the online order or test request option.
3. Enter patient details carefully.
4. Enter contact information.
5. Select the requested service or test if available.
6. Add referral or clinical information if requested.
7. Submit the request.

After submission, OLYVIA creates an order number. Keep this order number because it is used to track the request.

### 5.2 Track an Order

1. Open the patient portal.
2. Enter the order number.
3. Enter the patient last name and date of birth when requested.
4. Open the order detail page.

The portal may show sample pickup status, payment status, laboratory status, and report availability.

### 5.3 View a Report

Reports become available only after they are released by the laboratory. If the report is not visible, it may still be in processing, review, payment clearance, or final release.

When the report is available:

1. Open the patient portal.
2. Verify identity using the required details.
3. Open the order.
4. View or download the released report.

### 5.4 Patient Troubleshooting

If the portal cannot find your order:

- Check that the order number is typed correctly.
- Check that the last name matches the spelling used during registration.
- Check that the date of birth is correct.
- Contact X.PATH Labs if the problem continues.

## 6. Guide for Referring Clinicians and Doctors

Clinicians use the doctor portal to create referral orders, upload requisitions, follow cases, and view released reports for their patients.

### 6.1 Open the Doctor Portal

1. Open the OLYVIA login page.
2. Choose the clinician or doctor portal option.
3. Log in using your clinician account.

If you cannot access the doctor portal, contact an administrator to confirm that your user account is linked to a doctor or referrer profile.

### 6.2 Create or Select a Patient

1. Open the doctor portal.
2. Choose the patient or referral order option.
3. Search for an existing patient if available.
4. If the patient is new, create the patient profile.
5. Confirm patient demographics before creating an order.

### 6.3 Create a Referral Order

1. Select the patient.
2. Enter the clinical details.
3. Select the requested tests or services.
4. Upload a requisition form if required.
5. Review the order details.
6. Submit the referral order.

After submission, OLYVIA creates an order that the laboratory can receive and process.

### 6.4 Upload Requisition Documents

If the portal allows document upload:

1. Choose the upload option.
2. Select the requisition file or scanned document.
3. Confirm that the file is readable.
4. Save or submit.

If OCR or automatic document reading is configured, OLYVIA may help extract information from the document. Always review extracted information before submission.

### 6.5 Follow Referral Cases

The doctor portal can show cases connected to your clinician profile.

Use this area to:

- Check order status.
- See whether a report is released.
- View released reports.
- Confirm patient and order information.

### 6.6 Clinician Troubleshooting

If you cannot see a patient or report:

- Confirm you are logged in with the correct clinician account.
- Confirm your account is linked to the correct doctor profile.
- Confirm the report has been released.
- Contact X.PATH Labs for support if needed.

## 7. Guide for Receptionists

Receptionists manage intake. This includes creating orders, verifying patient information, receiving samples, and preparing cases for laboratory workflow.

### 7.1 Main Receptionist Responsibilities

Receptionists usually handle:

- Creating walk-in orders.
- Reviewing online orders.
- Confirming patient demographics.
- Recording referring doctor information.
- Capturing sample details.
- Checking payment or financial clearance status.
- Sending cases into laboratory processing.
- Coordinating with courier and finance teams.

### 7.2 Create a New Order

1. Open Create order.
2. Enter patient information.
3. Add contact details.
4. Select the referring doctor if applicable.
5. Select the requested tests.
6. Enter sample information.
7. Add clinical notes if available.
8. Review all information.
9. Save or submit the order.

Be careful with names, date of birth, phone numbers, and email addresses. These details are used later for patient portal access and report delivery.

### 7.3 Receive a Sample

1. Open the order.
2. Confirm the sample type.
3. Confirm the container or specimen details.
4. Confirm collection date and time if available.
5. Mark the sample as received when it reaches the laboratory.
6. Make sure the accession number is generated or visible.

### 7.4 Handle Online Orders

Online orders may arrive as drafts or pending intake. For each online order:

1. Open the order.
2. Verify patient details.
3. Confirm requested tests.
4. Confirm whether pickup is needed.
5. Check payment status.
6. Update the order so it can continue to courier, finance, or laboratory processing.

### 7.5 Work With Finance

If payment is required:

1. Check the payment or balance area.
2. Ask the patient to complete payment according to laboratory policy.
3. Finance can record and confirm payment.
4. Confirm that financial clearance is updated before release if required.

### 7.6 Receptionist Troubleshooting

If an order cannot move forward:

- Check whether required patient fields are missing.
- Check whether a test type is selected.
- Check whether the sample has been received.
- Check whether financial clearance is pending.
- Contact an administrator if the workflow is blocked.

## 8. Guide for Couriers

Couriers manage sample movement from pickup location to the laboratory.

### 8.1 Main Courier Responsibilities

Couriers usually handle:

- Viewing pickup requests.
- Updating pickup progress.
- Confirming sample handover.
- Recording transport information.
- Delivering samples to the laboratory.
- Marking samples as received at the lab when appropriate.

### 8.2 View Pickup Requests

1. Open the Courier page.
2. Review orders marked ready for pickup.
3. Check patient or facility pickup details.
4. Confirm pickup priority and location.

### 8.3 Update Pickup Status

Update the case as it moves through each step:

1. Ready for pickup.
2. On the way to pickup.
3. At site for pickup.
4. Picked up and on the way to lab.
5. In transit.
6. Received at lab.

Use the most accurate status. This helps reception, patients, and clinicians know where the sample is.

### 8.4 Record Transport Details

If fields are available, record:

- Pickup time.
- Handover person.
- Sample condition.
- Temperature information if required.
- Notes about delays or problems.

### 8.5 Courier Troubleshooting

If a pickup is missing:

- Confirm the order exists.
- Confirm pickup was requested.
- Confirm the order is assigned to the correct site or branch.
- Contact reception or an administrator.

## 9. Guide for Laboratory Technicians

Technicians manage the laboratory processing workflow. The exact steps depend on the test type.

### 9.1 Main Technician Responsibilities

Technicians usually handle:

- Viewing assigned work.
- Confirming sample receipt.
- Updating technical workflow steps.
- Managing histology, IHC, cytology, and digital pathology tasks.
- Creating or scanning block and slide IDs.
- Recording technical notes.
- Sending cases for pathology review.
- Monitoring inventory used in processing.

### 9.2 Open Technician Workflow

1. Log in.
2. Open Technician workflow.
3. Review assigned and pending cases.
4. Open the case you need to process.

### 9.3 Histology Workflow

For histology cases, common steps include:

1. Grossing: record gross description and specimen handling.
2. Processing: move tissue through the required processing protocol.
3. Embedding: create tissue blocks.
4. Sectioning: cut sections and prepare slides.
5. Staining: stain slides according to the test request.
6. Ready for review: mark the case ready for pathologist review.

Do not skip required steps. OLYVIA may enforce step order to protect quality and traceability.

### 9.4 IHC Workflow

For IHC cases:

1. Open the IHC module.
2. Confirm requested markers.
3. Record preparation and staining steps.
4. Add technical notes or exceptions.
5. Mark slides ready for pathologist review.

### 9.5 Cytology Workflow

For cytology cases:

1. Open the Cytology module.
2. Confirm sample type and preparation.
3. Record processing details.
4. Mark slides or preparations ready for pathologist review.

### 9.6 Digital Pathology

If digital pathology is used:

1. Open the Digital pathology module.
2. Attach or review slide images.
3. Confirm image quality.
4. Link digital assets to the correct case.
5. Notify or route to the pathologist when ready.

### 9.7 Inventory

Use the Inventory area to check or update supplies such as stains, reagents, consumables, and other laboratory items if your role allows it.

Record inventory changes accurately so the laboratory can avoid stockouts and maintain quality.

### 9.8 Technician Troubleshooting

If you cannot update a workflow step:

- Check whether the previous step is complete.
- Check whether the case is assigned to you or your team.
- Check whether the order has been received by the lab.
- Check whether a required field is missing.
- Contact an administrator if the workflow template appears incorrect.

## 10. Guide for Pathologists

Pathologists manage diagnostic reporting and second-review quality control.

### 10.1 Main Pathologist Responsibilities

Pathologists usually handle:

- Reviewing processed cases.
- Drafting pathology reports.
- Completing reports for second review.
- Reviewing reports from other pathologists.
- Returning reports with correction comments if needed.
- Validating second review when no corrections are needed.
- Finalizing reports after quality control.
- Releasing approved reports if authorized.
- Creating addenda when needed.

### 10.2 Open Pathologist Workflow

1. Log in.
2. Open Pathologist workflow.
3. Review pending cases.
4. Open the case you want to report.

### 10.3 Draft a Report

In the report workspace, enter the relevant report sections. These may include:

- Diagnosis.
- Gross description.
- Microscopic description.
- Comments or summary.
- Other case-specific fields.

Use Save draft while working. A saved draft is still red and cannot be released.

### 10.4 Complete Report for Second Review

When the reporting pathologist finishes drafting:

1. Review the report carefully.
2. Click the option to complete the report for second review.
3. OLYVIA changes the report status to yellow.
4. OLYVIA assigns the case to another pathologist for second review when available.

The original reporting pathologist should not be the second reviewer.

### 10.5 Second Pathologist Review

The reviewing pathologist opens the assigned case and checks the report.

If corrections are needed:

1. Enter clear review comments.
2. Return the report with corrections.
3. The original reporting pathologist reviews the comments and edits the report.
4. The case must complete the review process before it can become green.

If no corrections are needed:

1. Validate the second review.
2. Send the report back for finalization.

### 10.6 Finalize the Report

After second review is validated:

1. The original reporting pathologist reviews the final content.
2. Add a finalization note if required.
3. Finalize the report.
4. OLYVIA changes the report status to green.

Green means the report is approved and ready for release.

### 10.7 Release the Report

Only release a report when it is green and all laboratory policy requirements have been met.

Before release, confirm:

- Patient identity is correct.
- Order and accession details are correct.
- Report content is complete.
- Second review is complete.
- Financial clearance requirements are satisfied if applicable.

### 10.8 Addenda

If a report has already been completed and later needs additional information, use the addendum function if available. Addenda should be clear, dated, and clinically appropriate.

### 10.9 Pathologist Troubleshooting

If you cannot release a report:

- Check whether the report is still red or yellow.
- Check whether second review has been validated.
- Check whether the case has been finalized by the reporting pathologist.
- Check whether required report fields are empty.
- Check whether financial clearance is required.
- Contact an administrator if the case is stuck in the wrong status.

## 11. Guide for Finance Users

Finance users manage billing, payments, balances, and financial clearance.

### 11.1 Main Finance Responsibilities

Finance users usually handle:

- Viewing pending payments.
- Recording payments.
- Confirming payment clearance.
- Reviewing balances.
- Managing accounting information.
- Supporting payment-related patient and clinician questions.

### 11.2 Open Financial Dashboard

1. Log in.
2. Open Financial.
3. Review pending, partial, and cleared payments.
4. Open an order to see details.

### 11.3 Record a Payment

1. Open the order.
2. Find the payment or balance section.
3. Enter the payment amount.
4. Select payment method.
5. Add reference information if available.
6. Save the payment.
7. Confirm that the balance and clearance status update correctly.

### 11.4 Accounting

Use the Accounting area to review financial summaries, payment records, and accounting-related data. If external accounting integrations are configured, follow your organization policy for reconciliation.

### 11.5 Payment Integrations

If mobile money or another payment service is configured, OLYVIA may support payment requests or payment confirmation through that service. Always verify final payment status in OLYVIA before marking an order cleared.

### 11.6 Finance Troubleshooting

If payment does not appear:

- Check whether the order number is correct.
- Check whether the payment was saved.
- Check whether the external payment provider confirmed the transaction, if applicable.
- Check whether there is still an unpaid balance.
- Contact an administrator if payment status does not update.

## 12. Guide for Administrators

Administrators manage system setup and day-to-day configuration.

### 12.1 Main Administrator Responsibilities

Administrators usually handle:

- Creating and managing users.
- Assigning roles.
- Managing sites or branches.
- Managing doctors and referrers.
- Managing test types.
- Managing workflow templates.
- Managing system settings.
- Unlocking temporarily locked users if permitted.
- Supporting staff when access or workflow issues occur.

### 12.2 Create a User

1. Open Users.
2. Choose Create new user.
3. Enter the name.
4. Enter the email address.
5. Select the correct role.
6. Select the correct site.
7. Select preferred language.
8. Create or enter a temporary password.
9. Save the user.

Use a strong temporary password. The password should follow the displayed password requirements.

### 12.3 Choose the Correct Role

Common roles include:

| Role | Use This For |
| --- | --- |
| Super-admin | Full system administration and platform-level access. |
| Admin | Organization administration and configuration. |
| Receptionist | Order intake and reception workflow. |
| Technician | Laboratory technical processing. |
| Pathologist | Diagnostic reporting and second review. |
| Finance | Payment and accounting workflow. |
| Courier | Pickup and sample transport workflow. |
| Doctor | Referring clinician portal access. |

Assign the least access needed for the user to do their work.

### 12.4 Delete a User

Deleted accounts should be removed from the system and should no longer appear in the user interface. Before deleting a real user, confirm that deletion is allowed by your organization policy.

If you need to keep historical traceability, deactivate or archive may be more appropriate if such a workflow is configured. If the system is configured for permanent deletion, deletion erases the account record.

### 12.5 Unlock a User

If a user is locked out:

1. Open Users.
2. Search for the user.
3. Open the user actions.
4. Choose unlock if available.
5. Ask the user to try logging in again.

If the user still cannot log in, reset the password or contact technical support.

### 12.6 Manage Doctors and Referrers

Use Doctors and referrers to:

- Create clinician profiles.
- Update clinician contact details.
- Link doctor users to doctor profiles.
- Manage referral relationships.

Doctor portal users may need to be linked to a doctor profile before they can see referral cases.

### 12.7 Manage Test Types

Use Test types to configure available laboratory tests. Keep test names, prices, turnaround times, and workflow requirements accurate.

Incorrect test configuration can affect reception, finance, laboratory workflow, and reporting.

### 12.8 Manage Workflow Templates

Workflow templates define the steps that cases follow. Use them carefully.

When editing a workflow template:

- Confirm which test type it applies to.
- Confirm required steps.
- Confirm staff responsibilities.
- Avoid changing active workflows without communicating to affected teams.

### 12.9 Manage System Settings

Use System settings to configure organization-level behavior such as language, branding, release rules, notification settings, and other operational preferences when available.

### 12.10 Administrator Troubleshooting

If staff cannot see a page:

- Check their role.
- Check their site assignment.
- Check whether the account is active.
- Check whether they are using the correct login portal.

If user creation fails:

- Check required fields.
- Check that the role is selected.
- Check that the site is selected.
- Check that the password meets the rules.
- Check whether the email already exists.

## 13. Guide for Super-Admins

Super-admins have the highest level of access in OLYVIA. This role should be limited to trusted users.

### 13.1 Main Super-Admin Responsibilities

Super-admins usually handle:

- All administrator responsibilities.
- Creating and promoting admins.
- Unlocking locked accounts.
- Managing organization-level or platform-level settings.
- Reviewing enterprise modules.
- Managing all organizations if platform access is enabled.
- Coordinating production readiness and deployment issues.

### 13.2 User Governance

Super-admins should regularly review:

- Who has super-admin access.
- Whether former staff accounts have been removed.
- Whether test accounts have been deleted.
- Whether doctor users are linked correctly.
- Whether users belong to the correct site.

### 13.3 Platform and Organization Management

If platform tools are enabled, super-admins may manage multiple organizations or sites. Be careful when changing global settings because they can affect many users.

### 13.4 Production Support

If users see system-wide errors such as database unavailable, repeated login failures, or missing modules, super-admins should coordinate with the technical team immediately.

## 14. Communications and Notifications

OLYVIA includes communication and notification areas for staff collaboration.

### 14.1 Communications

Use Communications for work-related discussion. Keep messages clear and professional.

Good communication examples:

- "Order ORD-123456 is missing collection time."
- "Case XP-26-000123 needs IHC marker confirmation."
- "Payment reference received, please verify."

Avoid sharing unnecessary patient information in general messages.

### 14.2 Notifications

Notifications alert users about important events such as assigned tasks, workflow changes, report review needs, or other updates.

Check notifications regularly, especially if you are a pathologist, technician, receptionist, courier, finance user, admin, or super-admin.

## 15. End-to-End Workflow Examples

### 15.1 Walk-In Patient Workflow

1. Patient arrives at reception.
2. Receptionist creates the order.
3. Receptionist records patient, test, doctor, and sample details.
4. Finance records payment if required.
5. Sample is received and accessioned.
6. Technician processes the sample.
7. Pathologist drafts the report.
8. Report becomes yellow after completion and is sent for second review.
9. Second pathologist validates or returns corrections.
10. Reporting pathologist finalizes the case.
11. Report becomes green.
12. Authorized user releases the report.
13. Patient or clinician views the released report.

### 15.2 Online Patient Request Workflow

1. Patient submits an online request.
2. OLYVIA creates an order.
3. Reception reviews and confirms details.
4. Courier pickup is arranged if needed.
5. Finance confirms payment if required.
6. Sample reaches the laboratory.
7. Technician processes the sample.
8. Pathologist reporting and second review occur.
9. Report is finalized and released.
10. Patient accesses the released report through the portal.

### 15.3 Clinician Referral Workflow

1. Clinician logs into the doctor portal.
2. Clinician creates or selects a patient.
3. Clinician creates a referral order.
4. Clinician uploads requisition documents if required.
5. Reception and laboratory teams process the order.
6. Pathology report passes second review.
7. Report is released.
8. Clinician views the released report in the doctor portal.

### 15.4 Pathology Quality-Control Workflow

1. Reporting pathologist drafts the report. Status is red.
2. Reporting pathologist completes the report for second review. Status becomes yellow.
3. OLYVIA assigns another pathologist for review.
4. Reviewing pathologist checks the report.
5. If corrections are needed, the reviewing pathologist returns it with comments.
6. Reporting pathologist corrects the report.
7. Reviewing pathologist validates the review when satisfied.
8. Reporting pathologist finalizes the report.
9. Status becomes green.
10. Report can now be released.

## 16. Daily Checklists

### 16.1 Receptionist Daily Checklist

- Review new online orders.
- Create walk-in orders.
- Confirm patient demographics.
- Confirm requested tests.
- Confirm sample receipt.
- Check payment status.
- Route cases to the correct next step.

### 16.2 Courier Daily Checklist

- Review pickup queue.
- Update pickup status on time.
- Record sample condition.
- Deliver samples promptly.
- Confirm receipt at the laboratory.

### 16.3 Technician Daily Checklist

- Review assigned cases.
- Confirm sample and accession details.
- Complete workflow steps in order.
- Record technical notes.
- Mark cases ready for pathologist review.
- Update inventory usage where required.

### 16.4 Pathologist Daily Checklist

- Review assigned cases.
- Save drafts while working.
- Complete reports for second review.
- Review assigned second-review cases.
- Return corrections with clear comments when needed.
- Validate acceptable reports.
- Finalize only after review is complete.
- Release only green reports if authorized.

### 16.5 Finance Daily Checklist

- Review unpaid and partially paid orders.
- Record new payments.
- Confirm balances.
- Reconcile payment references.
- Mark orders cleared when payment rules are satisfied.

### 16.6 Administrator Daily Checklist

- Review new users or access requests.
- Unlock locked accounts when appropriate.
- Check test and workflow configuration changes.
- Confirm doctor profile links.
- Support staff with role or access issues.

### 16.7 Super-Admin Daily Checklist

- Review critical system alerts.
- Confirm key users can log in.
- Monitor production issues.
- Review high-level operational dashboards.
- Confirm no unauthorized super-admin access exists.

## 17. Common Troubleshooting

### 17.1 Login Does Not Work

Try the following:

1. Confirm the email is correct.
2. Use the eye icon to check the password while typing.
3. Confirm you are using the correct portal.
4. Check whether your account is locked.
5. Ask an admin or super-admin to reset your password.

If the message says the database is unavailable, contact technical support or a super-admin. This usually means the system cannot reach the configured PostgreSQL database.

### 17.2 I Cannot See a Menu

This usually means your role does not include that permission. Contact an admin if you believe your role is wrong.

### 17.3 I Cannot Create a User

Check:

- Name is entered.
- Email is valid.
- Role is selected.
- Site is selected.
- Preferred language is selected.
- Temporary password meets the displayed requirements.
- The email is not already used.

### 17.4 I Cannot Release a Report

Check:

- The report is green.
- Second review has been completed.
- Required fields are filled.
- The reporting pathologist finalized the report.
- Financial clearance is satisfied if required.

### 17.5 A Patient Cannot Find Their Order

Check:

- Correct order number.
- Correct spelling of last name.
- Correct date of birth.
- Whether the order has been created in OLYVIA.
- Whether patient details were entered correctly by reception or clinician.

### 17.6 A Clinician Cannot See Referral Cases

Check:

- The clinician is using the doctor portal.
- The user has the doctor role.
- The user is linked to a doctor or referrer profile.
- The cases are connected to that doctor profile.

### 17.7 The Page Feels Out of Date

Try refreshing the page. If the issue continues, log out and log back in. If the browser still shows old information, clear the browser cache or contact support.

## 18. Glossary

| Term | Meaning |
| --- | --- |
| Accession | Laboratory tracking number assigned to a received case. |
| Addendum | Additional report information added after the original report. |
| Admin | User who manages organization settings and users. |
| Case | Laboratory and reporting work connected to an order. |
| Courier | User who manages sample pickup and transport. |
| Doctor portal | Portal used by referring clinicians. |
| Financial clearance | Payment status showing whether payment requirements are satisfied. |
| Green report | Reviewed, finalized report ready for release. |
| IHC | Immunohistochemistry workflow. |
| LIMS | Lab Information Management System. |
| Order | Request for laboratory testing. |
| Patient portal | Public portal for patients to track orders and view released reports. |
| Pathologist | User who reports cases and performs second review. |
| Red report | Draft or in-progress report that cannot be released. |
| Second review | Quality-control review by another pathologist. |
| Super-admin | Highest access user with system-wide control. |
| Technician | User who processes samples in the laboratory workflow. |
| Yellow report | Report completed by first pathologist and waiting for second review. |

## 19. Best Practices

### 19.1 For Data Entry

- Type names exactly as shown on official documents.
- Confirm date of birth.
- Avoid abbreviations unless they are standard clinical abbreviations.
- Save notes that are clear and useful.
- Do not enter private comments that should not be part of the case history.

### 19.2 For Reporting

- Do not release red or yellow reports.
- Use second-review comments constructively.
- Make corrections before finalization.
- Confirm final content before release.

### 19.3 For Administration

- Give users only the access they need.
- Delete test accounts from live systems.
- Keep super-admin access limited.
- Review account access regularly.
- Keep configuration changes documented.

### 19.4 For Patient Communication

- Verify identity before discussing a case.
- Use the order number when helping patients.
- Explain that unreleased reports cannot be downloaded yet.
- Direct payment questions to finance when needed.

## 20. Support Path

When a problem occurs, start with the responsible team:

- Patient identity or order intake: Reception
- Pickup or transport: Courier team
- Sample processing: Laboratory technician team
- Report content or review: Pathology team
- Payment or balance: Finance
- Login, roles, locked account, or configuration: Admin or super-admin
- System-wide error or database unavailable: Super-admin and technical support

For urgent clinical or operational issues, contact the appropriate X.PATH Labs supervisor directly according to internal policy.
