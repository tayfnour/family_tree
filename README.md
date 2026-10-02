# شجرة العائلة

تطبيق ويب ثابت باللغة العربية لرسم شجرة العائلة وتعديلها وحفظها محليًا في المتصفح.

## التشغيل محليًا

يمكن فتح `index.html` مباشرة، أو تشغيل خادم ثابت من مجلد المشروع:

```powershell
py -m http.server 8080
```

ثم افتح: <http://localhost:8080/>

## النشر على Coolify

1. أنشئ موردًا جديدًا من نوع **Application** واربطه بمستودع GitHub.
2. اختر **Dockerfile** كطريقة البناء.
3. اترك مسار Dockerfile هو `/Dockerfile`.
4. اضبط المنفذ الداخلي على `80`.
5. نفّذ **Deploy**.

يستخدم المشروع Nginx داخل Docker، ولا يحتاج إلى PHP أو Node.js أو قاعدة بيانات. لا توجد أسرار أو متغيرات بيئية مطلوبة.

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
