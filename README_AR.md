# Smart Futures Signals — GitHub Actions + Cloudflare Worker

نسخة تشغيل مجانية دون خادم دائم أو مفاتيح تداول:
- GitHub Actions: فحص مجدول كل 30 دقيقة + تشغيل يدوي.
- Cloudflare Worker + KV: استقبال أوامر Telegram وحفظ قائمة العملات.
- Binance USDⓈ-M Futures public market data فقط. لا يوجد تنفيذ صفقات ولا API trading keys.

## 1) النشر
1. ارفع كل محتويات هذا المجلد إلى مستودع GitHub باسم `yusufFU` (Public).
2. أنشئ Cloudflare Worker، والصق محتوى `worker/worker.js`.
3. أنشئ KV namespace باسم `BOT_KV` واربطه بالـ Worker binding نفسه.
4. أضف Worker Variables/Secrets:
   - `BOT_TOKEN`: Telegram bot token (Secret)
   - `ALLOWED_CHAT_ID`: رقم Chat ID المسموح له (Variable)
   - `GITHUB_TOKEN`: Fine-grained token بصلاحية Actions: Read and write (Secret)
   - `GITHUB_OWNER`: اسم حساب GitHub
   - `GITHUB_REPO`: `yusufFU`
   - `ADMIN_SECRET`: قيمة طويلة عشوائية (Secret)
   - `TELEGRAM_WEBHOOK_SECRET`: قيمة عشوائية من 32 حرفاً أو أكثر (Secret)
5. في إعدادات المستودع GitHub > Settings > Secrets and variables > Actions أضف:
   - `WORKER_URL`: رابط Worker مثل https://اسمك.workers.dev
   - `SCANNER_SECRET`: نفس قيمة `ADMIN_SECRET`
   - `BOT_TOKEN`: توكن بوت Telegram (Secret)
   - `ALLOWED_CHAT_ID`: Chat ID (Secret)
6. افتح رابط Worker مع `/setup?key=ADMIN_SECRET` مرة واحدة لتسجيل Telegram webhook. لا تشارك هذا الرابط أو الأسرار.
7. أرسل `/start` للبوت.

## 2) أوامر Telegram
`/start`, `/help`, `/menu`, `/add SOLUSDT`, `/list`, `/remove SOLUSDT`,
`/scanlist`, `/scan SOLUSDT`, `/scanall`, `/top`, `/status`.

أوامر الفحص تطلب من GitHub Actions تشغيل مهمة؛ النتائج تصل لاحقاً إلى Telegram.
الأوامر الإدارية تقبل فقط Chat ID المحدد.

## 3) الفحص
- Cron كل 30 دقيقة (UTC)، وقد يتأخر GitHub عن الموعد المحدد.
- الفحص الشامل يختار أعلى 80 عقد USDT Perpetual من حيث حجم التداول لتقليل ضغط API ووقت المهمة.
- قائمة العملات الخاصة تفحص كل العملات الموجودة فيها.
- النتائج مبنية على EMA20/EMA50 و RSI و MACD وحجم التداول و ATR.
- الدرجة الفنية ليست احتمال نجاح إحصائياً ولا ضماناً أو توصية مالية.

## 4) حدود مهمة
- الخطة المجانية ليست SLA: قد تتأخر المهام أو تتوقف عند حدود الاستخدام.
- لا تستخدم مفاتيح Binance ولا تضعها في GitHub.
- لا ترفع `BOT_TOKEN`, `ADMIN_SECRET`, أو أي سر إلى ملفات المستودع.
- لا تشغّل Telegram polling بالتزامن؛ هذا المشروع يستخدم webhook.
