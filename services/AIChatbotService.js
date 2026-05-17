"use strict";

const { GoogleGenAI } = require("@google/genai");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

const ai = new GoogleGenAI({
  apiKey: GEMINI_API_KEY,
});

function fallbackReply(message) {
  const text = String(message || "").toLowerCase();

  if (text.includes("đặt lịch")) {
    return "Bạn có thể đăng nhập và vào mục Đặt lịch để chọn địa điểm, ngày và khung giờ hiến máu.";
  }

  if (
    text.includes("điều kiện") ||
    text.includes("hiến máu")
  ) {
    return "Người hiến máu cần đủ tuổi, sức khỏe ổn định và không mắc các bệnh chống chỉ định. Bạn nên liên hệ bệnh viện hoặc điểm hiến máu để được tư vấn cụ thể.";
  }

  if (text.includes("lịch hẹn")) {
    return "Nếu bạn đã đăng nhập, chatbot có thể hỗ trợ tra cứu lịch hẹn của bạn.";
  }

  if (text.includes("chiến dịch")) {
    return "Bạn có thể hỏi: Có chiến dịch hiến máu nào đang diễn ra không? Hệ thống sẽ tra cứu các chiến dịch đã được duyệt.";
  }

  if (
    text.includes("quy trình") ||
    text.includes("chuẩn bị") ||
    text.includes("sau khi hiến")
  ) {
    return "Quy trình hiến máu thường gồm: đăng ký thông tin, kiểm tra sức khỏe ban đầu, sàng lọc nhanh, tiến hành hiến máu, nghỉ ngơi và nhận hướng dẫn chăm sóc sau hiến máu.";
  }

  return "Hiện chatbot AI chưa thể trả lời câu này. Bạn có thể hỏi về đặt lịch, điều kiện hiến máu, quy trình hiến máu, lịch hẹn, lịch sử hiến máu hoặc chiến dịch hiến máu.";
}

module.exports = {
  async ask(message, authContext = "", userContext = "") {
    try {
      if (!GEMINI_API_KEY) {
        console.error("GEMINI ERROR: Missing GEMINI_API_KEY in .env");
        return fallbackReply(message);
      }

      const todayText = new Date().toLocaleDateString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });

      const prompt = `
Bạn là chatbot của hệ thống Smart Blood Donation.

NGÀY HIỆN TẠI:
${todayText}

TRẠNG THÁI NGƯỜI DÙNG:
${authContext || "Không có thông tin trạng thái đăng nhập."}

DỮ LIỆU NỘI BỘ HỆ THỐNG:
${userContext || "Không có dữ liệu nội bộ được cung cấp."}

NHIỆM VỤ:
Bạn hỗ trợ người dùng về hệ thống Smart Blood Donation, bao gồm:
- Kiến thức chung về hiến máu.
- Điều kiện hiến máu chung.
- Quy trình hiến máu.
- Cách chuẩn bị trước khi hiến máu.
- Chăm sóc sau khi hiến máu.
- Cách đặt lịch trên hệ thống.
- Giải thích trạng thái lịch hẹn nếu có dữ liệu.
- Hỗ trợ đọc thông tin cá nhân nếu dữ liệu nội bộ đã được cung cấp.

QUY TẮC QUAN TRỌNG:
1. Trả lời ngắn gọn, thân thiện, dễ hiểu, bằng tiếng Việt.

2. Nếu người dùng hỏi KIẾN THỨC CHUNG như:
- Quy trình hiến máu gồm những bước nào?
- Cần chuẩn bị gì trước khi hiến máu?
- Sau khi hiến máu nên làm gì?
- Điều kiện hiến máu chung là gì?
- Hiến máu có lợi ích gì?
- Cách đặt lịch hiến máu như thế nào?

Thì bạn ĐƯỢC PHÉP trả lời bằng kiến thức tổng quát, kể cả khi dữ liệu nội bộ không có thông tin.

3. Nếu người dùng hỏi DỮ LIỆU CÁ NHÂN hoặc DỮ LIỆU HỆ THỐNG RIÊNG như:
- Nhóm máu của tôi là gì?
- Tôi có lịch hẹn nào không?
- Lịch sử hiến máu của tôi?
- Tôi đã hiến máu bao nhiêu lần?
- Tôi có thông báo nào không?
- Lịch hẹn của tôi đang ở trạng thái gì?
- Mã lịch hẹn của tôi là gì?

Thì chỉ được trả lời dựa trên DỮ LIỆU NỘI BỘ HỆ THỐNG được cung cấp.

4. Nếu người dùng chưa đăng nhập mà hỏi dữ liệu cá nhân, hãy yêu cầu họ đăng nhập.

5. Nếu người dùng đã đăng nhập nhưng dữ liệu nội bộ không có thông tin tương ứng, hãy nói:
"Mình chưa tìm thấy dữ liệu này trong hệ thống."

6. Không bịa các dữ liệu sau:
- Nhóm máu.
- Lịch hẹn.
- Mã lịch hẹn.
- Lịch sử hiến máu.
- Số lần hiến máu.
- Thông báo.
- Trạng thái lịch hẹn.
- Chiến dịch đã đăng ký.
- Slot còn chỗ.
- Kho máu.

7. Không đưa chẩn đoán y tế chuyên sâu.
Nếu người dùng hỏi vấn đề sức khỏe cụ thể, hãy khuyên họ liên hệ bác sĩ hoặc nhân viên y tế.

8. Nếu câu hỏi liên quan thời điểm có thể hiến máu lại, có thể dựa vào ngày hiện tại và dữ liệu lần hiến gần nhất nếu được cung cấp. Tuy nhiên phải nhắc rằng kết quả chỉ mang tính tham khảo và cần được nhân viên y tế kiểm tra trực tiếp.

9. Các câu có dữ liệu nghiệp vụ chính xác như lịch hẹn, lịch sử hiến máu, nhóm máu, slot, chiến dịch, kho máu thường đã được backend xử lý trước khi gọi bạn. Nếu vẫn được gọi, hãy trả lời dựa đúng dữ liệu nội bộ, không suy đoán.

CÂU HỎI CỦA NGƯỜI DÙNG:
${message}
`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
      });

      return response.text || fallbackReply(message);
    } catch (err) {
      const errorText = err?.message || JSON.stringify(err);

      if (
        errorText.includes("RESOURCE_EXHAUSTED") ||
        errorText.includes("prepayment credits are depleted") ||
        errorText.includes("429")
      ) {
        console.error(
          "GEMINI BILLING ERROR: Project Gemini đã hết credit hoặc vượt quota."
        );
      } else {
        console.error("GEMINI ERROR:", errorText);
      }

      return fallbackReply(message);
    }
  },
};