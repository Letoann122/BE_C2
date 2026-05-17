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
const SlotAnalyticsController = require("../controllers/admin/SlotAnalyticsController");
// ===== COMMON =====
const NewsController = require("../controllers/NewsController");
const CampaignController = require("../controllers/donor/CampaignController");
const EmergencyResponseController = require("../controllers/donor/EmergencyResponseController");
const ChatbotController = require("../controllers/common/ChatbotController");
const optionalAuth = require("../middlewares/optionalAuth");
// ===== DONOR =====
const LoadProfileController = require("../controllers/donor/LoadProfileController");
const DonationSitesController = require("../controllers/donor/DonationSitesController");
const AppointmentController = require("../controllers/donor/AppointmentController");
const ProfileController = require("../controllers/ProfileController");
const ChangePasswordController = require("../controllers/ChangePassController");
const DonorController = require("../controllers/donor/DonorController");
const NearbyDonationController = require("../controllers/donor/NearbyDonationController");
const AchievementController = require("../controllers/donor/AchievementController");
const UserNotificationController = require("../controllers/donor/UserNotificationController");

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
const CheckinController = require("../controllers/doctor/CheckinController");
const DonationProcessController = require("../controllers/doctor/DonationProcessController");
const SlotTemplateController = require("../controllers/SlotTemplateController");
const LeaderboardController = require("../controllers/doctor/LeaderboardController");
const EmergencyRequestController = require("../controllers/doctor/EmergencyRequestController");
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
const AppointmentSlotController = require("../controllers/AppointmentSlotController");
const AchievementAdminController = require("../controllers/admin/AchievementAdminController");

// ==================== AUTH ====================
router.post("/register", CreateTaiKhoanRequest, validateRequest, RegisterController.register);
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
router.get("/support/emergency-active", SendNotificationController.activeEmergency);
router.post("/chatbot/message", optionalAuth, ChatbotController.ask);
// ==================== DONOR ROUTES ====================
const donorRouter = express.Router();

donorRouter.get("/check-token", DonorController.checkToken);
donorRouter.get("/profile", ProfileController.getProfile);
donorRouter.put("/profile", ProfileController.updateProfile);
donorRouter.put("/change-password", ChangePasswordController.changePassword);
donorRouter.get("/me", LoadProfileController.me);

donorRouter.get("/donation-sites", DonationSitesController.getAll);

// SLOT CAPACITY - DONOR
donorRouter.get("/appointment-slots", AppointmentSlotController.index);
donorRouter.get("/appointment-slots/:id", AppointmentSlotController.detail);

donorRouter.post("/donation-appointments", AppointmentController.create);
donorRouter.get("/donation-appointments", AppointmentController.myAppointments);
donorRouter.get("/donation-appointments/:id", AppointmentController.detail);
donorRouter.post("/donation-appointments/:id/cancel", AppointmentController.cancel);
donorRouter.post("/register-campaigns", CampaignController.donorCreateAppointment);
donorRouter.get("/donation-history", DonationHistoryController.index);
donorRouter.get("/nearby-donations", NearbyDonationController.index);
donorRouter.get("/appointment-process/detail", DonationProcessController.detail);

donorRouter.put("/location",verifyToken("donor"), ProfileController.updateLocation);

donorRouter.get("/achievements/profile", AchievementController.profile);
donorRouter.post("/achievements/sync", AchievementController.sync);

donorRouter.get("/emergency-responses/pending", EmergencyResponseController.pending);
donorRouter.post("/emergency-responses/accept", EmergencyResponseController.accept);
donorRouter.post("/emergency-responses/decline", EmergencyResponseController.decline);

donorRouter.get("/notifications", UserNotificationController.index);
donorRouter.get("/notifications/unread-count", UserNotificationController.unreadCount);
donorRouter.patch("/notifications/:id/read", UserNotificationController.markAsRead);
donorRouter.patch("/notifications/read-all", UserNotificationController.markAllAsRead);
donorRouter.delete("/notifications/clear-all", UserNotificationController.clearAll);


router.use("/donor", verifyToken("donor"), donorRouter);

// ==================== DOCTOR ROUTES ====================
const doctorRouter = express.Router();

doctorRouter.get("/check-token", DoctorController.checkToken);
doctorRouter.post("/appointments/mark-no-show", CheckinController.markNoShow);
doctorRouter.get("/profile", DoctorProfileController.getProfile);
doctorRouter.put("/profile", DoctorProfileController.updateProfile);
doctorRouter.put("/change-password", ChangePassDoctorController.changePassword);

doctorRouter.get("/inventory/current", InventoryController.current);

// SLOT CAPACITY - DOCTOR
doctorRouter.get("/appointment-slots", AppointmentSlotController.index);
doctorRouter.get("/appointment-slots/:id", AppointmentSlotController.detail);
doctorRouter.post("/appointment-slots", AppointmentSlotController.create);
doctorRouter.put("/appointment-slots/:id", AppointmentSlotController.update);
doctorRouter.delete("/appointment-slots/:id", AppointmentSlotController.delete);
doctorRouter.get("/appointment-slots/:id/appointments", AppointmentSlotController.appointments);
doctorRouter.get("/slot-templates", SlotTemplateController.index);
doctorRouter.put("/slot-templates/:id", SlotTemplateController.update);
doctorRouter.post("/slot-templates/generate", SlotTemplateController.generate);
doctorRouter.get("/donation-appointments", DonationAppointmentController.index);
doctorRouter.post("/donation-appointments/approve", DonationAppointmentController.approve);
doctorRouter.post("/donation-appointments/reject", DonationAppointmentController.reject);
doctorRouter.get(
  "/emergency-requests/:id/stats",
  EmergencyRequestController.stats
);

doctorRouter.get("/emergency-requests", EmergencyRequestController.index);
doctorRouter.post("/emergency-requests", EmergencyRequestController.store);
doctorRouter.get("/emergency-requests/:id", EmergencyRequestController.show);
doctorRouter.get(
  "/emergency-requests/:id/recommendations",
  EmergencyRequestController.recommendations
);
doctorRouter.post(
  "/emergency-requests/:id/recommendations/save",
  EmergencyRequestController.saveRecommendations
);

doctorRouter.get("/blood-inventory", BloodInventoryController.getAll);
doctorRouter.post("/blood-inventory", BloodInventoryController.create);
doctorRouter.post("/blood-inventory/filter", BloodInventoryController.filter);
doctorRouter.post("/blood-inventory/export", BloodInventoryController.export);

doctorRouter.get("/blood-inventory/logs", BloodInventoryController.logsAll);
doctorRouter.get("/blood-inventory/logs/:batch_id", BloodInventoryController.logsByBatch);
doctorRouter.get("/blood-inventory/:id", BloodInventoryController.getOne);
doctorRouter.put("/blood-inventory/:id", BloodInventoryController.update);
doctorRouter.delete("/blood-inventory/:id", BloodInventoryController.delete);

doctorRouter.get("/donation-appointments/approved", DonationController.index);
// doctorRouter.post("/donations/complete", DonationController.completeDonation);
doctorRouter.get("/reports/campaign-performance", ReportController.campaignPerformance);

doctorRouter.get("/news", NewsDoctorController.getMyNews);
doctorRouter.post("/news", NewsDoctorController.create);
doctorRouter.put("/news/:id", NewsDoctorController.update);
doctorRouter.post("/checkin", CheckinController.checkin);
doctorRouter.get("/checkin/today", CheckinController.todayCheckedIn);
doctorRouter.get("/donors", DonorManagementController.list);
doctorRouter.post("/donors/create", DonorManagementController.create);
doctorRouter.get("/donors/:id", DonorDetailController.detail);

doctorRouter.get("/campaigns", CampaignsController.getAllCampaigns);
doctorRouter.get("/campaigns/:id", CampaignsController.getCampaignDetail);
doctorRouter.post("/campaigns", CampaignsController.createCampaign);
doctorRouter.put("/campaigns/:id", CampaignsController.updateCampaign);
doctorRouter.patch("/campaigns/:id/close", CampaignsController.closeCampaign);
doctorRouter.get("/campaigns/:id/appointments", CampaignsController.getCampaignAppointments);
doctorRouter.post("/campaigns/:campaign_id/generate-slots", AppointmentSlotController.generateCampaign);
doctorRouter.post(
  "/emergency-requests/:id/send",
  EmergencyRequestController.sendToRecommendedDonors
);

doctorRouter.get("/support/notifications", SendNotificationController.listNotifications);
doctorRouter.post("/support/notifications", SendNotificationController.sendNotification);
doctorRouter.post("/emergency-alert", EmergencyAlertController.createEmergencyAlert);
doctorRouter.get("/donation-sites", DonationSitesController.getAll);
doctorRouter.get("/donation-process/detail", DonationProcessController.detail);

doctorRouter.post("/donation-process/start-screening", DonationProcessController.startScreening);
doctorRouter.post("/donation-process/fail-screening", DonationProcessController.failScreening);
doctorRouter.post("/donation-process/start-donation", DonationProcessController.startDonation);
doctorRouter.post("/donation-process/complete", DonationProcessController.completeDonation);

doctorRouter.get("/dashboard", DashboardDoctorController.index);
doctorRouter.get("/blood-testing/list", BloodInventoryController.testingList);
doctorRouter.post("/blood-testing/approve", BloodInventoryController.approveTesting);
doctorRouter.post("/blood-testing/reject", BloodInventoryController.rejectTesting);
doctorRouter.patch("/support/notifications/:id/close", SendNotificationController.closeNotification);

doctorRouter.get("/leaderboard", LeaderboardController.index);
doctorRouter.get("/leaderboard/campaign", LeaderboardController.campaign);
doctorRouter.get("/leaderboard/emergency", LeaderboardController.emergency);

router.use("/doctor", verifyToken("doctor"), doctorRouter);

// ==================== ADMIN ROUTES ====================
const adminRouter = express.Router();

adminRouter.get("/check-token", AdminController.checkToken);

// Quản lý user
adminRouter.get("/users", AdminDonorController.getAllUsers);
adminRouter.put("/users/:id", AdminDonorController.editUser);

// Dashboard
adminRouter.get("/dashboard", DashboardController.getDashboardStats);

// ACP bác sĩ
adminRouter.get("/doctors/pending", AcpDoctorController.getPending);
adminRouter.put("/doctors/:id/approve", AcpDoctorController.approve);
adminRouter.put("/doctors/:id/reject", AcpDoctorController.reject);
adminRouter.post("/doctors/search", AcpDoctorController.searchDoctor);

adminRouter.get("/slot-analytics", SlotAnalyticsController.overview);
// Quản lý kho máu
adminRouter.get("/inventory", InventoryAdminController.getAllInventory);

// SLOT CAPACITY - ADMIN
adminRouter.get("/appointment-slots", AppointmentSlotController.index);
adminRouter.get("/appointment-slots/:id", AppointmentSlotController.detail);
adminRouter.post("/appointment-slots", AppointmentSlotController.create);
adminRouter.put("/appointment-slots/:id", AppointmentSlotController.update);
adminRouter.delete("/appointment-slots/:id", AppointmentSlotController.delete);
adminRouter.get("/appointment-slots/:id/appointments", AppointmentSlotController.appointments);
adminRouter.get("/slot-templates", SlotTemplateController.index);
adminRouter.put("/slot-templates/:id", SlotTemplateController.update);
adminRouter.post("/slot-templates/generate", SlotTemplateController.generate);
adminRouter.post("/campaigns/:campaign_id/generate-slots", AppointmentSlotController.generateCampaign);
// Quản lý lịch hẹn
adminRouter.get("/appointments", AppointmentAdminController.index);
adminRouter.post("/appointments/bulk-approve", AppointmentAdminController.bulkApprove);
adminRouter.post("/appointments/bulk-cancel", AppointmentAdminController.bulkCancel);
adminRouter.post("/appointments/bulk-notify", AppointmentAdminController.bulkNotify);
adminRouter.get("/appointments/:id", AppointmentAdminController.detail);
adminRouter.get("/slot-dashboard", AppointmentSlotController.dashboard);
// ==================== CAMPAIGNS (ADMIN) ====================
adminRouter.get("/campaigns/pending", CampaignApprovalController.listPending);
adminRouter.patch("/campaigns/:id/approve", CampaignApprovalController.approve);
adminRouter.patch("/campaigns/:id/reject", CampaignApprovalController.reject);
adminRouter.get("/campaigns", CampaignsController.getAllCampaigns);
adminRouter.get("/campaigns/:id", CampaignsController.getCampaignDetail);
adminRouter.get("/campaigns/:id/appointments", CampaignsController.getCampaignAppointments);
adminRouter.put("/campaigns/:id", CampaignsController.updateCampaign);
adminRouter.patch("/campaigns/:id/close", CampaignsController.closeCampaign);
adminRouter.get("/donation-sites", CampaignsManagementController.getDonationSites);

adminRouter.get("/achievements", AchievementAdminController.index);
adminRouter.post("/achievements", AchievementAdminController.store);
adminRouter.put("/achievements/:id", AchievementAdminController.update);
adminRouter.patch("/achievements/:id/toggle", AchievementAdminController.toggle);
adminRouter.delete("/achievements/:id", AchievementAdminController.destroy);

adminRouter.get("/campaign-registrations", CampaignController.adminListCampaignRegistrations);
adminRouter.patch("/campaign-registrations/:id/approve", CampaignController.adminApproveCampaignRegistration);
adminRouter.patch("/campaign-registrations/:id/reject", CampaignController.adminRejectCampaignRegistration);

adminRouter.get("/blood-inventory/dashboard", BloodInventoryDashboardController.getDashboard);

adminRouter.get("/news/pending", AdminNewsController.getPendingNews);
adminRouter.get("/news", AdminNewsController.getAllNews);
adminRouter.patch("/news/:id/approve", AdminNewsController.approveNews);
adminRouter.patch("/news/:id/reject", AdminNewsController.rejectNews);
adminRouter.delete("/news/:id", AdminNewsController.deleteNews);

router.use("/admin", verifyToken("admin"), adminRouter);

module.exports = router;