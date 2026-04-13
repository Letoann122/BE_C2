const express = require("express");
const router = express.Router();

const {
  RegisterController,
  ActivateController,
  LoginController,
  LogoutController,
  ForgotPasswordController,
  ResetPasswordController,
} = require("../controllers");

const verifyToken = require("../middlewares/verifyToken");
const validateRequest = require("../middlewares/validateRequest");
const LoginRequest = require("../middlewares/LoginRequest");
const CreateTaiKhoanRequest = require("../requests/client/CreateTaiKhoanRequest");
const BookingDonationRequest = require("../requests/client/BookingDonationRequest");
const NewsDoctorController = require("../controllers/doctor/NewsDoctorController");
// ===== COMMON =====
const NewsController = require("../controllers/NewsController");
const CampaignController = require("../controllers/donor/CampaignController");
// ===== DONOR =====
const LoadProfileController = require("../controllers/donor/LoadProfileController");
const DonationSitesController = require("../controllers/donor/DonationSitesController");
const AppointmentController = require("../controllers/donor/AppointmentController");
const ProfileController = require("../controllers/ProfileController");
const ChangePasswordController = require("../controllers/ChangePassController");
const DonorController = require("../controllers/donor/DonorController");

// ===== DOCTOR =====
const DoctorController = require("../controllers/doctor/DoctorController");
const DoctorProfileController = require("../controllers/doctor/DoctorProfileController");
const ChangePassDoctorController = require("../controllers/doctor/ChangePassController");
const InventoryController = require("../controllers/doctor/InventoryController");
const BloodInventoryController = require("../controllers/doctor/BloodInventoryController");
const DonationAppointmentController = require("../controllers/doctor/DonationAppointmentController");
const DonationController = require("../controllers/doctor/DonationController");
const DonorManagementController = require("../controllers/doctor/DonorManagementController");
const DonorDetailController = require("../controllers/doctor/DonorDetailController");
const CampaignsController = require("../controllers/doctor/CampaignsController");
const sendNotificationController = require("../controllers/doctor/SendNotificationController");

// ===== ADMIN =====
const AdminController = require("../controllers/admin/AdminController");
const AdminDonorController = require("../controllers/admin/AdminDonorController");
const DashboardController = require("../controllers/admin/DashboardController");
const AcpDoctorController = require("../controllers/admin/AcpDoctorController");
const InventoryAdminController = require("../controllers/admin/InventoryAdminController");
const AppointmentAdminController = require("../controllers/admin/AppointmentAdminController");
const CampaignsManagementController = require("../controllers/admin/CampaignsManagementController"); 
const CampaignApprovalController = require("../controllers/admin/CampaignApprovalController"); 
const DonationHistoryController = require("../controllers/donor/DonationHistoryController");
const SendNotificationController = require("../controllers/doctor/SendNotificationController");
const EmergencyAlertController = require("../controllers/doctor/EmergencyAlertController");
const DashboardDoctorController = require("../controllers/doctor/DashboardDoctorController");
const ReportController = require("../controllers/doctor/ReportController");
const BloodInventoryDashboardController = require("../controllers/admin/BloodInventoryDashboardController");
const AdminNewsController = require("../controllers/admin/AdminNewsController");
const ContactController = require("../controllers/donor/ContactController");

// ==================== AUTH ====================
router.post(
  "/register",
  CreateTaiKhoanRequest,
  validateRequest,
  RegisterController.register
);
router.post("/login", LoginRequest, validateRequest, LoginController.login);
router.get("/logout", LogoutController.logout);

router.get("/activate/:token", ActivateController.activate);
router.post("/forgot-password", ForgotPasswordController.forgotPassword);
router.post("/reset-password", ResetPasswordController.resetPassword);
router.post("/contact", ContactController.sendContact);

// ==================== PUBLIC ====================
router.get("/news", NewsController.getAll);
router.get("/news/:id", NewsController.getById);
router.get("/public/campaigns", CampaignController.publicCampaigns);
router.get("/public/campaigns/:id", CampaignController.publicCampaignDetail);
router.get("/public/emergency-alert", EmergencyAlertController.getEmergencyAlert);

// ==================== DONOR ROUTES ====================
const donorRouter = express.Router();

donorRouter.get("/check-token", DonorController.checkToken);
donorRouter.get("/profile", ProfileController.getProfile);
donorRouter.put("/profile", ProfileController.updateProfile);
donorRouter.put("/change-password", ChangePasswordController.changePassword);
donorRouter.get("/me", LoadProfileController.me);

donorRouter.get("/donation-sites", DonationSitesController.getAll);

donorRouter.post("/donation-appointments", BookingDonationRequest, AppointmentController.create);
donorRouter.get("/donation-appointments", AppointmentController.myList);
donorRouter.post("/donation-appointments/:id/cancel", AppointmentController.cancel);
donorRouter.post("/register-campaigns", CampaignController.donorCreateAppointment);
donorRouter.get("/donation-history", DonationHistoryController.index);
router.use("/donor", verifyToken("donor"), donorRouter);

// ==================== DOCTOR ROUTES ====================
const doctorRouter = express.Router();

doctorRouter.get("/check-token", DoctorController.checkToken);

doctorRouter.get("/profile", DoctorProfileController.getProfile);
doctorRouter.put("/profile", DoctorProfileController.updateProfile);
doctorRouter.put("/change-password", ChangePassDoctorController.changePassword);

doctorRouter.get("/inventory/current", InventoryController.current);

doctorRouter.get("/donation-appointments", DonationAppointmentController.index);
doctorRouter.post("/donation-appointments/approve", DonationAppointmentController.approve);
doctorRouter.post("/donation-appointments/reject", DonationAppointmentController.reject);

doctorRouter.get("/blood-inventory", BloodInventoryController.getAll);
doctorRouter.post("/blood-inventory", BloodInventoryController.create);
doctorRouter.post("/blood-inventory/filter", BloodInventoryController.filter);
doctorRouter.post("/blood-inventory/export", BloodInventoryController.export);

// ✅ logs đặt trước :id
doctorRouter.get("/blood-inventory/logs", BloodInventoryController.logsAll);
doctorRouter.get("/blood-inventory/logs/:batch_id", BloodInventoryController.logsByBatch);
//test
// :id để cuối cùng trong nhóm GET
doctorRouter.get("/blood-inventory/:id", BloodInventoryController.getOne);
doctorRouter.put("/blood-inventory/:id", BloodInventoryController.update);
doctorRouter.delete("/blood-inventory/:id", BloodInventoryController.delete);

doctorRouter.get("/donation-appointments/approved", DonationController.index);
doctorRouter.post("/donations/complete", DonationController.completeDonation);
doctorRouter.get("/reports/campaign-performance", ReportController.campaignPerformance);

doctorRouter.get("/news", NewsDoctorController.getMyNews);
doctorRouter.post("/news", NewsDoctorController.create);
doctorRouter.put("/news/:id", NewsDoctorController.update);

doctorRouter.get("/donors", DonorManagementController.list);
doctorRouter.post("/donors/create", DonorManagementController.create);
doctorRouter.get("/donors/:id", DonorDetailController.detail);

// campaigns (doctor/hospital side)
doctorRouter.get("/campaigns", CampaignsController.getAllCampaigns);
doctorRouter.get("/campaigns/:id", CampaignsController.getCampaignDetail);
doctorRouter.post("/campaigns", CampaignsController.createCampaign);
doctorRouter.put("/campaigns/:id", CampaignsController.updateCampaign);
doctorRouter.patch("/campaigns/:id/close", CampaignsController.closeCampaign);
doctorRouter.get("/campaigns/:id/appointments", CampaignsController.getCampaignAppointments);
doctorRouter.get("/support/notifications", SendNotificationController.listNotifications);
doctorRouter.post("/support/notifications", SendNotificationController.sendNotification);
doctorRouter.post("/emergency-alert", EmergencyAlertController. createEmergencyAlert);
doctorRouter.get("/donation-sites", DonationSitesController.getAll);

doctorRouter.get("/dashboard", DashboardDoctorController.index);

router.use("/doctor", verifyToken("doctor"), doctorRouter);

// ==================== ADMIN ROUTES ====================
const adminRouter = express.Router();

adminRouter.get("/check-token", AdminController.checkToken);

// Quản lý user
adminRouter.get("/users", AdminDonorController.getAllUsers);
adminRouter.put("/users/:id", AdminDonorController.editUser);

// Dashboard
adminRouter.get("/dashboard", DashboardController.getDashboardStats);
router.get("/doctors/pending", AcpDoctorController.getPending);
router.post("/doctors/search", AcpDoctorController.searchDoctor); // nếu bạn đang dùng
router.put("/doctors/:id/approve", AcpDoctorController.approve);
router.put("/doctors/:id/reject", AcpDoctorController.reject);
// ACP bác sĩ
adminRouter.get("/doctors/pending", AcpDoctorController.getPending);
adminRouter.put("/doctors/:id/approve", AcpDoctorController.approve);
adminRouter.put("/doctors/:id/reject", AcpDoctorController.reject);
adminRouter.post("/doctors/search", AcpDoctorController.searchDoctor);

// Quản lý kho máu
adminRouter.get("/inventory", InventoryAdminController.getAllInventory);

// Quản lý lịch hẹn
adminRouter.get("/appointments", AppointmentAdminController.index);
adminRouter.post("/appointments/bulk-approve", AppointmentAdminController.bulkApprove);
adminRouter.post("/appointments/bulk-cancel", AppointmentAdminController.bulkCancel);
adminRouter.post("/appointments/bulk-notify", AppointmentAdminController.bulkNotify);
adminRouter.get("/appointments", AppointmentAdminController.index);
adminRouter.get("/appointments/:id", AppointmentAdminController.detail);

// ==================== CAMPAIGNS (ADMIN) ====================
// 1) Pending list
adminRouter.get("/campaigns/pending", CampaignApprovalController.listPending);

// 2) Approve / Reject
adminRouter.patch("/campaigns/:id/approve", CampaignApprovalController.approve);
adminRouter.patch("/campaigns/:id/reject", CampaignApprovalController.reject);

// 3) Management list (all + filters)
adminRouter.get("/campaigns", CampaignsController.getAllCampaigns);

// 4) Detail
adminRouter.get("/campaigns/:id", CampaignsController.getCampaignDetail);
adminRouter.get("/campaigns/:id/appointments", CampaignsController.getCampaignAppointments);

// 5) Update
adminRouter.put("/campaigns/:id", CampaignsController.updateCampaign);

// 6) Close
adminRouter.patch("/campaigns/:id/close", CampaignsController.closeCampaign);

// 7) Donation sites (for edit modal)
adminRouter.get("/donation-sites", CampaignsManagementController.getDonationSites);

adminRouter.get("/campaign-registrations", CampaignController.adminListCampaignRegistrations);
adminRouter.patch("/campaign-registrations/:id/approve", CampaignController.adminApproveCampaignRegistration);
adminRouter.patch("/campaign-registrations/:id/reject", CampaignController.adminRejectCampaignRegistration);

adminRouter.get("/blood-inventory/dashboard", BloodInventoryDashboardController.getDashboard);

adminRouter.get("/news/pending", AdminNewsController.getPendingNews);
adminRouter.get("/news", AdminNewsController.getAllNews);
adminRouter.patch("/news/:id/approve", AdminNewsController.approveNews);
adminRouter.patch("/news/:id/reject", AdminNewsController.rejectNews);
adminRouter.delete("/news/:id", AdminNewsController.deleteNews);

// Bọc middleware verifyToken cho toàn bộ /admin
router.use("/admin", verifyToken("admin"), adminRouter);

module.exports = router;
