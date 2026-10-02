# شجرة العائلة

تطبيق Python/Flask باللغة العربية لرسم شجرة العائلة وتعديلها وحفظها محليًا في المتصفح.

## التشغيل محليًا

ثبّت الاعتمادات ثم شغّل Flask محليًا:

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

ثم افتح: <http://localhost:8000/>

## النشر على Coolify

1. أنشئ موردًا جديدًا من نوع **Application** واربطه بمستودع GitHub.
2. اختر **Dockerfile** كطريقة البناء.
3. اترك مسار Dockerfile هو `/Dockerfile`.
4. اضبط المنفذ الداخلي على `8000`.
5. أضف Health Check على المسار `/health` إن كان الخيار متاحًا.
6. نفّذ **Deploy**.

يستخدم المشروع Flask مع Gunicorn داخل Docker، ولا يحتاج إلى PHP أو Node.js أو قاعدة بيانات. يستمع Docker على المنفذ `8000` بشكل ثابت، ولا توجد أسرار أو متغيرات بيئية إضافية مطلوبة.

## GitHub Pages

ملف GitHub Actions الموجود في `.github/workflows/pages.yml` ينشر النسخة الثابتة تلقائيًا عند الدفع إلى فرع `main`. من إعدادات المستودع اختر **Pages → Source: GitHub Actions**.

## رفع المستودع إلى GitHub

من داخل مجلد المشروع، إذا كان المستودع البعيد فارغًا:

```powershell
git init
git branch -M main
git remote add origin https://github.com/tayfourdrive1-cmyk/family_tree.git
git add .
git commit -m "Prepare family tree app for deployment"
git push -u origin main
```

بعد الدفع، استخدم نفس المستودع كمصدر تطبيق في Coolify.

## البيانات

تُحفظ بيانات الشجرة في `localStorage` داخل المتصفح تحت المفتاح `familyTreeData`. استخدم أزرار التصدير والاستيراد الموجودة داخل التطبيق للاحتفاظ بنسخة احتياطية JSON.
