/* ==========================================================================
   📡 الربط المباشر — مشترك بين صفحة المعلمة وصفحة الطالبات (لا تحتاجين لتعديله)
   --------------------------------------------------------------------------
   شكل البيانات في Firebase Realtime Database:
     teachers/{رمز المعلمة}         ← { name, pin } تُضاف من Firebase Console فقط
     staff/{رمز المعلمة}/{uid}     ← جهاز المعلمة بعد إدخال الرقم السري الصحيح
     (الغرفة = رمز المعلمة، وهو نفسه «رمز الفصل» الذي تكتبه الطالبات)
     rooms/{الغرفة}/live                 ← رقم الشريحة الحالية عند المعلمة (نفس مشروع Firebase لعرض أ. نجود — لكل معلمة غرفتها)
     rooms/{الغرفة}/answers/{شريحة}/{مجموعة} ← إجابة كل مجموعة { v, t }
     rooms/{الغرفة}/ideas/{شريحة}/{id}       ← أفكار العصف الذهني { team, text, t }
     rooms/{الغرفة}/reveal/{شريحة}          ← true عند كشف الإجابة على الأجهزة
     rooms/{الغرفة}/awarded/{شريحة}         ← true بعد منح النقاط تلقائيًا
     rooms/{الغرفة}/scores                ← نقاط المجموعات
     rooms/{الغرفة}/presence/{مجموعة}/{id}  ← الأجهزة المتصلة
   ========================================================================== */
const LIVE = (() => {
  const qs = new URLSearchParams(location.search);
  // رمز المعلمة/الفصل: أرقام وحروف إنجليزية فقط
  const clean = s => String(s || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  let room = clean(qs.get('room'));
  const cfg = window.FIREBASE_CONFIG || {};
  const configured = !!(cfg.apiKey && cfg.databaseURL) && !/ضعي|your-project/i.test(cfg.apiKey + cfg.databaseURL);
  const ok = configured && !!window.firebase;
  const why = !configured ? 'config' : (!window.firebase ? 'offline' : null);

  let db = null, authError = null, ready = Promise.resolve(), offset = 0;
  if (ok) {
    firebase.initializeApp(cfg);
    db = firebase.database();
    // فرق الساعة بين الجهاز والخادم — ليكون المؤقت متزامنًا على كل الأجهزة
    db.ref('.info/serverTimeOffset').on('value', s => { offset = +s.val() || 0; });
    ready = firebase.auth().signInAnonymously()
      .catch(e => { authError = e; console.warn('تعذّر تسجيل الدخول المجهول (فعّلي Anonymous من Authentication):', e); });
  }

  /* ---------- أدوات نصية ---------- */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const strip = h => String(h ?? '').replace(/<br\s*\/?>/gi,' ').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
  // توحيد الكتابة العربية للمقارنة: بدون تشكيل، الهمزات، التاء المربوطة، «ال»
  const norm = s => String(s ?? '').trim().toLowerCase()
    .replace(/[ً-ْـ]/g,'').replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي')
    .replace(/^ال/,'').replace(/\s+/g,' ');

  /* ---------- سؤال الآيباد لكل شريحة (حسب نوعها) ---------- */
  function taskFor(s){
    if (!s || s.student === false) return null;
    if (s.student && typeof s.student === 'object') return Object.assign({ kind:'text' }, s.student);
    const opt = o => ({ icon:o.i, t:o.t });
    switch (s.type) {
      case 'mcq':        return { kind:'choice', q:s.q, options:s.options.map(opt), answer:s.answer, model:s.explain };
      case 'drive':      return { kind:'choice', q:s.question, options:s.levels.map((l,k)=>({ icon:['🟢','🟡','🔴'][k]||'🚗', t:l.n })), answer:s.levels.length-1,
                                  model:s.levels.map(l=>`<b>${l.n}:</b> ${l.who}`).join('<br>') };
      case 'loopSort':   return { kind:'sort', q:strip(s.task), buckets:s.bins.map((b,k)=>({ key:String(k), label:b.t, icon:b.i, color:b.c })),
                                  items:s.items.map(x=>({ t:x.t, b:String(x.b) })) };
      case 'challenge':  return { kind:'sort', q:'صنّفي كل مثال: ذكاء اصطناعي 🤖 أم برنامج عادي ⚙️؟',
                                  buckets:[{ key:'1', label:'ذكاء اصطناعي', icon:'🤖', color:'#7C3AED' }, { key:'0', label:'برنامج عادي', icon:'⚙️', color:'#F59E0B' }],
                                  items:s.items.map(x=>({ t:x.t, b:x.ai?'1':'0' })) };
      case 'order':      return { kind:'order', q:'رتّبي خطوات تعلّم الآلة من الأولى إلى الأخيرة:', items:s.steps.map(opt) };
      case 'tf':         return { kind:'tf', q:'صح أم خطأ؟', items:s.items.map(x=>({ t:x.t, a:x.a, why:x.fix || '' })) };
      case 'definition': return { kind:'blanks', q:'أكملي تعريف الذكاء الاصطناعي:',
                                  text:s.parts.map(p=>typeof p==='string'?p:`[${p.w}]`).join(' '), words:s.parts.filter(p=>typeof p!=='string').map(p=>p.w) };
      case 'brainstorm': return { kind:'ideas', q:s.question };
      case 'video':      return { kind:'texts', q:'👀 شاهدي الفيديو، ثم أجيبي:', items:s.watch.map(q=>({ label:'', q })) };
      case 'tps':        return { kind:'text', q:s.question };
      case 'drone':      return { kind:'text', q:s.question, model:'أربع مراوح (مروحية رباعية) ترفع الطائرة وتوجّهها وتحافظ على توازنها في الجو.' };
      case 'groups':     return { kind:'text', q:strip(s.task), perTeam:s.groups.map(g=>`${g.i} المجال <b>${g.t}</b>: اذكرن استخدامًا للطائرة المسيّرة فيه + مشكلة أمن أو خصوصية قد تنشأ عنه.`),
                                  model:s.groups.map(g=>`${g.i} <b>${g.t}:</b> ${g.a}`).join('<br>') };
      case 'hots':       return { kind:'texts', q:s.scenario, items:s.questions.map(x=>({ label:x.level, q:x.q, a:x.a })) };
      case 'exit':       return { kind:'texts', q:'🎫 تذكرة الخروج (3 – 2 – 1):', items:s.cards.map(c=>({ label:'', q:`<b>${c.n}</b> ${c.t}` })) };
      case 'closing':    return { kind:'rate', q:'كيف تقيّمين فهمكِ للدرس؟',
                                  items:[{ e:'😀', m:'فهمتُ تمامًا 🌟' }, { e:'🙂', m:'أحتاج قليلًا من المراجعة' }, { e:'🤔', m:'أحتاج مساعدة من المعلمة' }] };
    }
    return null;
  }

  /* ---------- التصحيح التلقائي: يعيد {ok,total} أو null للأسئلة المفتوحة ---------- */
  function grade(t, v){
    if (!t || v == null) return null;
    const count = (n, f) => { let ok=0; for (let i=0;i<n;i++) if (f(i)) ok++; return { ok, total:n }; };
    switch (t.kind) {
      case 'choice': return { ok: +v === t.answer ? 1 : 0, total:1 };
      case 'blanks': return count(t.words.length, i => v[i] != null && norm(v[i]) === norm(t.words[i]));
      case 'order':  return count(t.items.length, i => v[i] === i);
      case 'sort':   return count(t.items.length, i => v[i] === t.items[i].b);
      case 'tf':     return count(t.items.length, i => v[i] === t.items[i].a);
    }
    return null;
  }

  /* ---------- المعلمات: الاسم + الدخول بالرقم السري ---------- */
  const teacherName = id => db.ref(`teachers/${clean(id)}/name`).once('value').then(s => s.val());
  // قواعد Firebase تقبل هذا التسجيل فقط إذا طابق الرقم السري المحفوظ لهذه المعلمة
  const login = (id, pin) => db.ref(`staff/${clean(id)}/${firebase.auth().currentUser.uid}`).set(String(pin).trim());
  const logout = id => db.ref(`staff/${clean(id)}/${firebase.auth().currentUser.uid}`).remove();

  return {
    ok, why, ready, clean, teacherName, login, logout,
    get room(){ return room; },
    setRoom(r){ room = clean(r); },
    get authError(){ return authError; },
    ref: p => db.ref(`rooms/${room}/${p}`),
    ts: () => firebase.database.ServerValue.TIMESTAMP,
    now: () => Date.now() + offset,
    onConn: fn => db.ref('.info/connected').on('value', s => fn(!!s.val())),
    taskFor, grade, esc, strip, norm
  };
})();
