(function () {
  var CATS = [
    { key: 'ai',    label: 'AI & machine learning', color: 'var(--blue)' },
    { key: 'app',   label: 'Mobile & web',          color: 'var(--red)' },
    { key: 'cloud', label: 'Cloud & infrastructure',color: 'var(--green)' },
    { key: 'biz',   label: 'Business & growth',     color: 'var(--yellow)' }
  ];

  var P = [
    ['Gemini','assets/logos/gemini.svg','https://gemini.google.com/','ai','Multimodal AI models and the Gemini app.'],
    ['AI Studio','assets/logos/ai-studio.svg','https://aistudio.google.com/','ai','Prompt, tune and ship against the Gemini API.'],
    ['Antigravity','assets/logos/products/antigravity.png','https://antigravity.google/','ai','Agent-first development environment.'],
    ['Colab','assets/logos/products/colab.png','https://colab.research.google.com/','ai','Hosted notebooks with free GPUs.'],
    ['Android','assets/logos/android.png','https://developer.android.com/','app','The mobile platform and its SDK.'],
    ['Flutter','assets/logos/products/flutter.svg','https://flutter.dev/','app','One codebase for mobile, web and desktop.'],
    ['ChromeOS','assets/logos/products/chromeos.svg','https://www.google.com/chromebook/chrome-os/','app','Web-first OS for low-cost hardware.'],
    ['Search Central','assets/logos/products/search-central.svg','https://developers.google.com/search','app','Make what you build discoverable.'],
    ['Google Cloud','assets/logos/google-cloud.png','https://cloud.google.com/','cloud','Compute, storage and Vertex AI.'],
    ['Firebase','assets/logos/firebase.svg','https://firebase.google.com/','cloud','Auth, database and hosting for apps.'],
    ['Maps Platform','assets/logos/google-maps.png','https://www.google.com/maps','cloud','Location, routes and places APIs.'],
    ['Analytics','assets/logos/google-analytics.svg','https://marketingplatform.google.com/about/analytics/','cloud','Measure how people use what you ship.'],
    ['Google Ads','assets/logos/products/google-ads.svg','https://ads.google.com/','biz','Reach an audience for your product.'],
    ['AdMob','assets/logos/products/admob.png','https://admob.google.com/','biz','Monetise mobile apps with ads.'],
    ['Play Console','assets/logos/products/play-store.png','https://play.google.com/console/','biz','Publish and manage Android releases.'],
    ['Privacy Sandbox','assets/logos/products/privacy-sandbox.svg','https://privacysandbox.google.com/','biz','Privacy-preserving web and app APIs.']
  ].map(function (r) {
    return { name: r[0], icon: r[1], url: r[2], cat: r[3], desc: r[4] };
  });

  function catOf(k) { for (var i=0;i<CATS.length;i++) if (CATS[i].key===k) return CATS[i]; }
  function el(t, c) { var n = document.createElement(t); if (c) n.className = c; return n; }

  /* ---------- AI ECOSYSTEM (orbit dataset) ---------- */
  var ICON = {
    'Gemini':                       'assets/logos/gemini.svg',
    'Gemma':                        'assets/logos/gemini.svg',
    'Gemini API':                   'assets/logos/gemini.svg',
    'Gemini CLI':                   'assets/logos/gemini.svg',
    'Gemini Code Assist':           'assets/logos/gemini.svg',
    'Google AI Studio':             'assets/logos/ai-studio.svg',
    'Vertex AI':                    'assets/logos/google-cloud.png',
    'Firebase AI':                  'assets/logos/firebase.svg',
    'Google Antigravity':           'assets/logos/products/antigravity.png',
    'Agent SDKs':                   'assets/logos/products/adk.png',
    'NotebookLM':                   'assets/logos/products/notebooklm.svg',
    'Chrome':                       'assets/logos/products/chromeos.svg',
    'Android':                      'assets/logos/android.png',
    'Search':                       'assets/logos/products/search-central.svg',
    'Google Cloud':                 'assets/logos/google-cloud.png',
    'BigQuery':                     'assets/logos/google-cloud.png',
    'Cloud Storage':                'assets/logos/google-cloud.png',
    'Cloud Run':                    'assets/logos/google-cloud.png',
    'Data Analytics':               'assets/logos/google-analytics.svg'
  };

  var AI = [
    { key:'foundation', label:'Foundation Models', color:'#4285F4',
      items:['Gemini','Gemma','Veo','Imagen','Lyria','Nano Banana','Gemini Audio','Gemini Robotics','Genie'] },
    { key:'platforms',  label:'AI Platforms',      color:'#0F9D58',
      items:['Google AI Studio','Gemini API','Vertex AI','Gemini Enterprise Agent Platform','Firebase AI'] },
    { key:'agents',     label:'Agent Development', color:'#F4B400',
      items:['Google Antigravity','Gemini CLI','Gemini Code Assist','Managed Agents','Agent SDKs'] },
    { key:'apps',       label:'AI Applications',   color:'#DB4437',
      items:['Gemini','NotebookLM','Search','Chrome','Workspace','Photos','YouTube','Android'] },
    { key:'creative',   label:'Creative AI',       color:'#AB47BC',
      items:['Flow','Whisk','ImageFX','Veo','Imagen','Lyria'] },
    { key:'science',    label:'AI for Science',    color:'#00ACC1',
      items:['AlphaFold','AlphaEarth','AlphaEvolve','WeatherNext','Gemini for Science'] },
    { key:'infra',      label:'Infrastructure',    color:'#5C6BC0',
      items:['Google Cloud','TPUs','BigQuery','Cloud Storage','Cloud Run','Data Analytics','Vertex AI'] },
    { key:'deepmind',   label:'Google DeepMind',   color:'#EC407A',
      items:['Research','Models','Robotics','World models','Science'] }
  ];

  function renderOrbit(mount) {
    /* SIZE is the SVG coordinate space; CSS scales the element to min(1100px,96vw) */
    var SIZE=1000, C=SIZE/2, RC=130, RI=260, RO=440, ns='http://www.w3.org/2000/svg';
    var selected=null;

    var svg=document.createElementNS(ns,'svg');
    svg.setAttribute('viewBox','0 0 '+SIZE+' '+SIZE);
    svg.setAttribute('class','orbit-svg');
    mount.appendChild(svg);

    var layer=el('div','orbit-layer'); mount.appendChild(layer);
    var core=el('button','orbit-core'); core.type='button'; mount.appendChild(core);

    function polar(r,a){ return [C+Math.cos(a)*r, C+Math.sin(a)*r]; }
    function arcPath(r,a0,a1){
      var s=polar(r,a0), e=polar(r,a1);
      var large=(a1-a0)>Math.PI?1:0;
      return 'M'+s[0]+' '+s[1]+' A'+r+' '+r+' 0 '+large+' 1 '+e[0]+' '+e[1];
    }

    function makeNode(nm, color, href, isBtn) {
      var n = isBtn ? el('button','orbit-node') : el('a','orbit-node');
      if(isBtn){ n.type='button'; } else { n.href=href||'#'; }
      n.style.setProperty('--c', color);
      var icon = ICON[nm]
        ? '<img src="'+ICON[nm]+'" alt="">'
        : '<span class="orbit-dot" style="background:'+color+'"></span>';
      n.innerHTML = icon + '<span>'+nm+'</span>';
      return n;
    }

    function draw(){
      svg.innerHTML=''; layer.innerHTML='';

      /* rings */
      [RC, RI, RO].forEach(function(r,i){
        var c=document.createElementNS(ns,'circle');
        c.setAttribute('cx',C); c.setAttribute('cy',C); c.setAttribute('r',r);
        c.setAttribute('class','orbit-ring'+(i===0?' orbit-ring-core':''));
        svg.appendChild(c);
      });

      var span=(Math.PI*2)/AI.length;

      AI.forEach(function(cat,i){
        var a0=i*span-Math.PI/2, a1=a0+span, mid=a0+span/2;
        var isSelected = selected===cat.key;
        var isDim = selected && !isSelected;

        /* spoke */
        var ln=document.createElementNS(ns,'line');
        var p1=polar(RC,a0), p2=polar(RO+30,a0);
        ln.setAttribute('x1',p1[0]); ln.setAttribute('y1',p1[1]);
        ln.setAttribute('x2',p2[0]); ln.setAttribute('y2',p2[1]);
        ln.setAttribute('class','orbit-spoke');
        svg.appendChild(ln);

        /* coloured arc band (between RC and RI) */
        var band=document.createElementNS(ns,'path');
        band.setAttribute('d', arcPath((RI+RC)/2, a0+0.03, a1-0.03));
        band.setAttribute('class','orbit-band'+(isDim?' is-dim':'')+(isSelected?' is-on':''));
        band.setAttribute('stroke',cat.color);
        svg.appendChild(band);

        /* category label inside band — always visible */
        var pos=polar((RI+RC)/2, mid);
        var btn=el('button','orbit-cat-btn'+(isDim?' is-dim':'')+(isSelected?' is-on':''));
        btn.type='button';
        btn.style.left=(pos[0]/SIZE*100)+'%';
        btn.style.top=(pos[1]/SIZE*100)+'%';
        btn.style.setProperty('--c', cat.color);
        btn.innerHTML='<span>'+cat.label+'</span><em>'+cat.items.length+'</em>';
        btn.addEventListener('click',function(){ selected=(isSelected)?null:cat.key; draw(); });
        layer.appendChild(btn);

        /* OUTER RING */
        if(isSelected){
          /* drill-down: fan ALL products around the full outer ring */
          cat.items.forEach(function(nm,j){
            var t=(j+0.5)/cat.items.length;
            var a=-Math.PI/2+Math.PI*2*t;
            var np=polar(RO,a);
            var n=makeNode(nm, cat.color, null, false);
            n.style.left=(np[0]/SIZE*100)+'%';
            n.style.top=(np[1]/SIZE*100)+'%';
            layer.appendChild(n);
          });
        } else {
          /* default: one category node per wedge on the outer ring — ALWAYS VISIBLE */
          var nm=cat.items[0];
          var np=polar(RO, mid);
          var n=makeNode(nm, cat.color, null, true);
          n.classList.add('orbit-cat-node');
          n.style.left=(np[0]/SIZE*100)+'%';
          n.style.top=(np[1]/SIZE*100)+'%';
          if(isDim) n.classList.add('is-dim');
          /* clicking the outer node also drills in */
          (function(key){ n.addEventListener('click',function(){ selected=key; draw(); }); })(cat.key);
          layer.appendChild(n);
        }
      });

      /* core button */
      if(selected){
        var c=AI.filter(function(x){return x.key===selected;})[0];
        core.innerHTML='<strong style="color:'+c.color+'">'+c.label+'</strong><br><span>'+c.items.length+' products · tap to go back</span>';
        core.classList.add('is-drilled');
      } else {
        core.innerHTML='<strong>Google AI</strong><br><span>Tap a category</span>';
        core.classList.remove('is-drilled');
      }
    }

    core.addEventListener('click',function(){ selected=null; draw(); });
    draw();
  }

  /* ---------- GRID ---------- */
  function renderGrid(mount) {
    P.forEach(function (p) {
      var a = el('a', 'eco-grid-item');
      a.href = p.url; a.rel = 'noopener';
      a.setAttribute('data-cat', p.cat);
      a.innerHTML = '<img src="' + p.icon + '" alt=""><span>' + p.name + '</span>';
      mount.appendChild(a);
    });
  }

  /* ---------- TABLE ---------- */
  function renderTable(mount) {
    CATS.forEach(function (cat) {
      var h = el('p', 'ecosystem-category-label');
      h.textContent = cat.label;
      mount.appendChild(h);
      P.filter(function (p) { return p.cat === cat.key; }).forEach(function (p) {
        var row = el('a', 'eco-row');
        row.href = p.url; row.rel = 'noopener';
        row.setAttribute('data-cat', p.cat);
        row.innerHTML =
          '<img src="' + p.icon + '" alt="">' +
          '<span class="eco-row-name">' + p.name + '</span>' +
          '<span class="eco-row-desc">' + p.desc + '</span>' +
          '<span class="eco-row-go" aria-hidden="true">→</span>';
        mount.appendChild(row);
      });
    });
  }

  /* ---------- switching ---------- */
  function init() {
    var orbit = document.getElementById('orbitMount');
    if (orbit) renderOrbit(orbit);
    var grid = document.getElementById('gridMount');
    if (grid) renderGrid(grid);
    var table = document.getElementById('tableMount');
    if (table) renderTable(table);

    var btns = Array.prototype.slice.call(document.querySelectorAll('.eco-switch-btn'));
    var thumb = document.querySelector('.eco-switch-thumb');

    function moveThumb(btn) {
      if (!thumb || !btn) return;
      thumb.style.width = btn.offsetWidth + 'px';
      thumb.style.transform = 'translateX(' + btn.offsetLeft + 'px)';
    }

    function show(view) {
      btns.forEach(function (b) {
        var on = b.dataset.view === view;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on) moveThumb(b);
      });
      ['orbit', 'list', 'grid', 'table'].forEach(function (v) {
        var panel = document.getElementById('view-' + v);
        if (panel) panel.classList.toggle('is-hidden', v !== view);
      });
    }

    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        show(b.dataset.view);
        history.replaceState(null,'','#'+b.dataset.view);
      });
    });

    var VIEWS = ['orbit','list','grid','table'];
    function fromHash(){ var h=(location.hash||'').replace('#',''); return VIEWS.indexOf(h)>-1?h:null; }
    window.addEventListener('hashchange', function(){ var v=fromHash(); if(v) show(v); });

    var initial = fromHash();
    if (initial) { show(initial); }
    var active = document.querySelector('.eco-switch-btn.is-active');
    requestAnimationFrame(function () { moveThumb(active); });
    window.addEventListener('resize', function () {
      moveThumb(document.querySelector('.eco-switch-btn.is-active'));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
