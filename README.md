# راه‌یار | RahyAR

سامانه فول‌استک رزرو سفرهای بین‌شهری با احراز هویت OTP، انتخاب صندلی، پرداخت، پنل مسافر و راننده، مدیریت مدارک و موقعیت زنده خودرو.

![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-realtime-010101?logo=socket.io&logoColor=white)

## معرفی

راه‌یار یک پلتفرم رزرو خودرو برای سفرهای بین‌شهری است. مسافر می‌تواند مسیر، تاریخ، راننده، خودرو و صندلی خود را انتخاب کند. راننده می‌تواند خودرو، مدارک، سفر و موقعیت لحظه‌ای خود را مدیریت کند و مدیر سیستم به آمار، رانندگان و محتوای مجله دسترسی دارد.

این نسخه یک MVP اجرایی است و به‌جای داده‌های ساختگی از API، PostgreSQL، JWT، تراکنش رزرو و WebSocket استفاده می‌کند.

## امکانات

- ورود و ثبت‌نام با شماره موبایل و OTP
- نقش‌های مسافر، راننده و مدیر سیستم
- جست‌وجوی سفر بر اساس مبدا، مقصد و تاریخ
- نمایش مشخصات راننده، خودرو، امتیاز و ظرفیت باقی‌مانده
- انتخاب چند صندلی و جلوگیری از رزرو هم‌زمان با تراکنش PostgreSQL
- ثبت رزرو و سابقه پرداخت
- قوانین لغو و محاسبه مبلغ بازگشت وجه
- ثبت خودرو و مدارک راننده
- ثبت، تایید و شروع سفر
- ارسال موقعیت زنده راننده با Socket.IO
- پنل مسافر برای مشاهده و لغو رزرو
- پنل مدیر برای آمار و تایید یا رد راننده‌ها
- انتشار مقاله در مجله سایت
- Helmet، CORS، Rate Limit، JWT و کوئری‌های پارامتری

## فناوری‌ها

- Backend: Node.js و Express.js
- Database: PostgreSQL 16
- Realtime: Socket.IO
- Authentication: JWT و OTP
- Frontend: HTML، CSS و JavaScript واکنش‌گرا
- Infrastructure: Docker Compose

## شروع سریع

پیش‌نیازها: Node.js نسخه ۲۰ یا بالاتر، npm و Docker Desktop.

```bash
git clone https://github.com/YOUR_USERNAME/rahyar-intercity.git
cd rahyar-intercity
cp .env.example .env
docker compose up -d postgres
npm install
npm start
```

سپس به آدرس زیر بروید:

```text
http://localhost:4000
```

در اولین اجرا جدول‌ها و داده‌های اولیه به‌صورت خودکار ساخته می‌شوند.

## حساب‌های محیط توسعه

در حالت توسعه، کد OTP برابر `123456` است:

| نقش | شماره موبایل |
|---|---|
| مسافر | `09120000002` |
| راننده تاییدشده | `09120000001` |
| مدیر | `09000000000` |

در محیط واقعی، `NODE_ENV=production` تنظیم کنید. در این حالت کد OTP داخل پاسخ API برگردانده نمی‌شود.

## متغیرهای محیطی

فایل `.env.example` را به `.env` کپی کنید:

```env
PORT=4000
DATABASE_URL=postgres://rahyar:rahyar@localhost:5432/rahyar
JWT_SECRET=replace-this-with-a-long-random-secret
OTP_TTL_SECONDS=180
NODE_ENV=development
```

## APIهای مهم

```text
POST /api/auth/request-otp
POST /api/auth/verify-otp
GET  /api/me
GET  /api/trips?origin=تهران&destination=رشت
GET  /api/trips/:id
POST /api/trips/:id/reservations
GET  /api/me/reservations
POST /api/reservations/:id/cancel
POST /api/driver/trips
POST /api/driver/location
GET  /api/admin/stats
```

## اتصال سرویس‌های واقعی

ساختار ثبت پرداخت و بازگشت وجه در API وجود دارد. برای استفاده عملیاتی باید adapter درگاه بانکی، سرویس پیامک، فضای ذخیره مدارک، HTTPS و کلیدهای امن محیط اجرا تنظیم شوند. هیچ کلید یا اطلاعات محرمانه‌ای را در GitHub قرار ندهید.

## وضعیت پروژه

- [x] احراز هویت و نقش‌ها
- [x] جست‌وجوی سفر و انتخاب صندلی
- [x] رزرو تراکنشی و لغو
- [x] پنل مسافر، راننده و مدیر
- [x] موقعیت زنده راننده
- [x] مقاله‌های مجله
- [ ] اتصال نهایی به پیامک و درگاه بانکی انتخابی
- [ ] تست‌های خودکار و استقرار ابری

## مجوز

این پروژه برای توسعه و ارزیابی محصول راه‌یار ارائه شده است. نوع مجوز را قبل از انتشار عمومی مشخص کنید.
