import { createScene } from './scene.js';

const { gsap, ScrollTrigger, Lenis } = window;
gsap.registerPlugin(ScrollTrigger);

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(pointer: fine)').matches;
const lowPower = !finePointer || window.innerWidth < 768 || (navigator.hardwareConcurrency || 8) <= 4;
const isReturn = document.documentElement.classList.contains('is-return');
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* ---------------------------------------------------------------- scene */
let scene = null;
try {
    scene = createScene($('.webgl'), { lowPower, reduceMotion });
} catch (err) {
    // No WebGL: the page still works, just without the 3D layer.
    console.warn('WebGL unavailable', err);
    document.body.classList.add('no-webgl');
}

/* ------------------------------------------------------------ smooth scroll */
let lenis = null;
if (!reduceMotion) {
    lenis = new Lenis({ duration: 1.15, easing: (t) => 1 - Math.pow(1 - t, 4) });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
    lenis.stop();
}

// same-page anchors glide through Lenis instead of jumping
$$('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
        const id = a.getAttribute('href');
        const target = id === '#top' ? 0 : $(id);
        if (target === null) return;
        e.preventDefault();
        closeMenu();
        if (lenis) lenis.scrollTo(target, { duration: 1.4 });
        else if (target === 0) window.scrollTo(0, 0);
        else target.scrollIntoView();
    });
});

/* ------------------------------------------------------- page transitions */
const curtain = $('.curtain');
gsap.set(curtain, { yPercent: isReturn ? 0 : 100 });

document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank') return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.protocol === 'mailto:') return;
    if (url.pathname === location.pathname && url.hash) return; // in-page anchor
    e.preventDefault();
    closeMenu();
    if (reduceMotion) { location.href = url.href; return; }
    gsap.fromTo(curtain, { yPercent: 100 }, {
        yPercent: 0, duration: 0.75, ease: 'expo.inOut',
        onComplete: () => { location.href = url.href; },
    });
});

// Back/forward from the bfcache would otherwise show the closed curtain.
window.addEventListener('pageshow', (e) => {
    if (e.persisted) gsap.set(curtain, { yPercent: -100 });
});

/* ------------------------------------------------------------- text split */
function splitChars(el) {
    const text = el.textContent;
    el.setAttribute('aria-label', text);
    el.textContent = '';
    return [...text].map((ch) => {
        const s = document.createElement('span');
        s.className = 'char';
        s.setAttribute('aria-hidden', 'true');
        s.textContent = ch === ' ' ? ' ' : ch;
        el.appendChild(s);
        return s;
    });
}
function splitWords(el) {
    const words = el.textContent.trim().split(/\s+/);
    el.textContent = '';
    return words.map((w, i) => {
        const s = document.createElement('span');
        s.className = 'word';
        s.textContent = w;
        el.appendChild(s);
        if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
        return s;
    });
}

const introChars = $$('.js-split').flatMap(splitChars);
const scrollTitles = $$('.js-split-scroll');
const wordBlocks = $$('.js-words');

/* --------------------------------------------------------- 3D choreography */
// Where the object cluster sits while each section is on screen.
// `mx` is used on portrait phones, where the cluster hugs the edges so it never sits under text.
const POSES = {
    hero:       { x: 2.4,  mx: 0.8,  y: 0,    scale: 1,    rotY: 0,    rotX: 0,    spread: 1,    glow: 1 },
    page:       { x: 3.2,  mx: 1.4,  y: 0.6,  scale: 0.85, rotY: 0.6,  rotX: 0.1,  spread: 1.1,  glow: 0.9 },
    about:      { x: 3.4,  mx: 2.9,  y: 0.2,  scale: 0.72, rotY: 1.4,  rotX: 0.2,  spread: 1.6,  glow: 0.8 },
    experience: { x: -3.6, mx: -2.9, y: -0.3, scale: 0.6,  rotY: 2.6,  rotX: -0.2, spread: 1.1,  glow: 0.55 },
    work:       { x: 0,    mx: 2.9,  y: 0,    scale: 0.5,  rotY: 3.6,  rotX: 0.3,  spread: 2.2,  glow: 0.35 },
    projects:   { x: 3.8,  mx: 2.9,  y: 0.4,  scale: 0.55, rotY: 4.6,  rotX: 0,    spread: 1.2,  glow: 0.5 },
    skills:     { x: -3.6, mx: -2.9, y: -0.2, scale: 0.6,  rotY: 5.6,  rotX: -0.2, spread: 1.3,  glow: 0.55 },
    contact:    { x: 3.7,  mx: 1.2,  y: 0.5,  scale: 0.8,  rotY: 6.8,  rotX: 0,    spread: 0.9,  glow: 1 },
    // contact page: tucked top-right, clear of the form and the links column
    contactPage:{ x: 3.4,  mx: 1.8,  y: 1.5,  scale: 0.6,  rotY: 0.4,  rotX: 0.1,  spread: 1,    glow: 0.9 },
    // long-read sections: small, in the bottom-right corner, behind the text
    aside:      { x: 4.6,  mx: 3.1,  y: -1.9, scale: 0.4,  rotY: 3,    rotX: 0.2,  spread: 1.3,  glow: 0.3 },
};
const narrow = window.matchMedia('(max-aspect-ratio: 4/5)').matches;
const pose = (name) => {
    const { mx, ...p } = POSES[name] || POSES.page;
    if (narrow) { p.x = mx; if (!['hero', 'page', 'contactPage'].includes(name)) p.scale *= 0.8; }
    return p;
};
const sceneSections = $$('[data-scene]');
const firstPose = pose(sceneSections[0]?.dataset.scene || 'page');

if (scene) {
    Object.assign(scene.state, firstPose, { scale: 0.2, rotY: firstPose.rotY - 1.2, spread: 0.2 });
    sceneSections.slice(1).forEach((sec) => {
        gsap.to(scene.state, {
            ...pose(sec.dataset.scene),
            ease: 'none',
            immediateRender: false,
            scrollTrigger: { trigger: sec, start: 'top bottom', end: 'top 30%', scrub: 1.2 },
        });
    });
}

/* ---------------------------------------------------------------- intro */
gsap.set(introChars, { yPercent: 110 });
gsap.set('[data-intro], .nav', { autoAlpha: 0, y: 20 });

const pageReady = Promise.all([
    document.fonts ? document.fonts.ready : Promise.resolve(),
    new Promise((r) => (document.readyState === 'complete' ? r() : window.addEventListener('load', r, { once: true }))),
]);

function playIntro(tl, at) {
    if (scene) {
        tl.to(scene.state, { scale: firstPose.scale, rotY: firstPose.rotY, spread: firstPose.spread, duration: 2.4, ease: 'expo.out' }, at);
    }
    tl.to(introChars, { yPercent: 0, duration: 1.3, ease: 'expo.out', stagger: 0.035 }, at)
        .to('.nav, [data-intro]', { autoAlpha: 1, y: 0, duration: 1, ease: 'power3.out', stagger: 0.1 }, '<0.4');
}

const done = () => { document.body.classList.remove('is-loading'); lenis?.start(); ScrollTrigger.refresh(); };

if (isReturn) {
    // coming from another page: just lift the curtain
    pageReady.then(() => {
        const tl = gsap.timeline({ onComplete: done });
        tl.to(curtain, { yPercent: -100, duration: 0.9, ease: 'expo.inOut' });
        playIntro(tl, '-=0.45');
    });
} else {
    const count = { v: 0 };
    const countEl = $('.js-count');
    const barEl = $('.loader__bar span');
    const draw = () => {
        countEl.textContent = Math.round(count.v);
        barEl.style.transform = `scaleX(${count.v / 100})`;
    };
    const countTween = gsap.to(count, { v: 90, duration: 1.6, ease: 'power2.out', onUpdate: draw });

    pageReady.then(() => {
        countTween.kill();
        try { sessionStorage.setItem('dm-visited', '1'); } catch (_) { /* private mode */ }
        const tl = gsap.timeline({ onComplete: done });
        tl.to(count, { v: 100, duration: 0.5, ease: 'power1.out', onUpdate: draw })
            .to('.loader__inner', { yPercent: -100, autoAlpha: 0, duration: 0.6, ease: 'power3.in' })
            .to('.loader', { yPercent: -100, duration: 1, ease: 'expo.inOut' }, '-=0.1')
            .set('.loader', { display: 'none' });
        playIntro(tl, '-=0.6');
    });
}

/* ------------------------------------------------------------ hero details */
const clock = $('.js-clock');
if (clock) {
    const fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' });
    const tickClock = () => { clock.textContent = fmt.format(new Date()); };
    tickClock();
    setInterval(tickClock, 30000);
}
$$('.js-year').forEach((el) => { el.textContent = new Date().getFullYear(); });

// rotating role line
const roles = $$('.js-roles > span');
if (roles.length) {
    let roleIdx = 0;
    gsap.set(roles, { yPercent: 100, autoAlpha: 0 });
    gsap.set(roles[0], { yPercent: 0, autoAlpha: 1 });
    setInterval(() => {
        const cur = roles[roleIdx];
        roleIdx = (roleIdx + 1) % roles.length;
        gsap.to(cur, { yPercent: -100, autoAlpha: 0, duration: 0.7, ease: 'power3.inOut' });
        gsap.fromTo(roles[roleIdx], { yPercent: 100, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.7, ease: 'power3.inOut' });
    }, 2800);
}

// big titles drift away as you scroll off the first screen
if (!reduceMotion) {
    $$('.hero__title, .page-hero__title').forEach((title) => {
        gsap.to(title, {
            yPercent: -30, autoAlpha: 0.2, ease: 'none',
            scrollTrigger: { trigger: title.closest('section'), start: 'top top', end: 'bottom top', scrub: true },
        });
    });
}

/* --------------------------------------------------------------- reveals */
$$('[data-reveal]').forEach((el) => {
    gsap.from(el, {
        y: reduceMotion ? 0 : 60, autoAlpha: 0, duration: 1.2, ease: 'expo.out',
        scrollTrigger: { trigger: el, start: 'top 88%', once: true },
    });
});

// statements light up word by word
wordBlocks.forEach((block) => {
    gsap.fromTo(splitWords(block), { opacity: 0.14 }, {
        opacity: 1, stagger: 0.1, ease: 'none',
        scrollTrigger: { trigger: block, start: 'top 80%', end: 'bottom 45%', scrub: true },
    });
});

// big titles further down the page rise in
scrollTitles.forEach((title) => {
    const chars = splitChars(title);
    gsap.set(chars, { yPercent: 110 });
    ScrollTrigger.create({
        trigger: title, start: 'top 88%', once: true,
        onEnter: () => gsap.to(chars, { yPercent: 0, duration: 1.2, ease: 'expo.out', stagger: 0.03 }),
    });
});

// Portrait drifts inside its frame
if ($('.portrait')) {
    gsap.fromTo('.portrait__frame img', { yPercent: -8 }, {
        yPercent: 0, ease: 'none',
        scrollTrigger: { trigger: '.portrait', start: 'top bottom', end: 'bottom top', scrub: true },
    });
}

// Numbers count up once visible
$$('.js-countup').forEach((el) => {
    const o = { v: 0 };
    ScrollTrigger.create({
        trigger: el, start: 'top 90%', once: true,
        onEnter: () => gsap.to(o, { v: +el.dataset.to, duration: 2, ease: 'power3.out', onUpdate: () => { el.textContent = Math.round(o.v); } }),
    });
});
$$('.js-progress').forEach((el) => {
    gsap.fromTo(el, { scaleX: 0 }, {
        scaleX: el.dataset.to / 100, duration: 2, ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 90%', once: true },
    });
});

/* ------------------------------------------------- horizontal work gallery */
const track = $('.work__track');
if (track) {
    ScrollTrigger.matchMedia({
        '(min-width: 900px)': () => {
            const distance = () => track.scrollWidth - window.innerWidth + parseFloat(getComputedStyle(track).paddingRight || 0);
            const tween = gsap.to(track, {
                x: () => -distance(),
                ease: 'none',
                scrollTrigger: {
                    trigger: '.work',
                    pin: '.work__pin',
                    start: 'top top',
                    end: () => '+=' + distance(),
                    scrub: 1,
                    invalidateOnRefresh: true,
                },
            });
            // cards lean into the direction of travel
            $$('.card', track).forEach((card) => {
                gsap.fromTo(card, { rotateY: -18, z: -120 }, {
                    rotateY: 0, z: 0, ease: 'none',
                    scrollTrigger: { trigger: card, containerAnimation: tween, start: 'left right', end: 'left 45%', scrub: true },
                });
            });
            return () => gsap.set(track, { clearProps: 'x' });
        },
    });
}

/* ------------------------------------------------------------ 3D card tilt */
if (finePointer && !reduceMotion) {
    // gallery cards already lean on scroll, so they only get the cursor glow
    $$('.card').forEach((el) => {
        el.addEventListener('pointermove', (e) => {
            const r = el.getBoundingClientRect();
            el.style.setProperty('--mx', `${e.clientX - r.left}px`);
            el.style.setProperty('--my', `${e.clientY - r.top}px`);
        });
    });
    $$('.post, .skill, .portrait').forEach((el) => {
        const qx = gsap.quickTo(el, 'rotateY', { duration: 0.6, ease: 'power3' });
        const qy = gsap.quickTo(el, 'rotateX', { duration: 0.6, ease: 'power3' });
        el.addEventListener('pointermove', (e) => {
            const r = el.getBoundingClientRect();
            const px = (e.clientX - r.left) / r.width - 0.5;
            const py = (e.clientY - r.top) / r.height - 0.5;
            qx(px * 10);
            qy(-py * 10);
            el.style.setProperty('--mx', `${(px + 0.5) * 100}%`);
            el.style.setProperty('--my', `${(py + 0.5) * 100}%`);
        });
        el.addEventListener('pointerleave', () => { qx(0); qy(0); });
    });
}

/* ------------------------------------------------ project list hover image */
const preview = $('.preview');
if (preview && finePointer) {
    const previewImg = $('img', preview);
    const px = gsap.quickTo(preview, 'x', { duration: 0.5, ease: 'power3' });
    const py = gsap.quickTo(preview, 'y', { duration: 0.5, ease: 'power3' });
    const rot = gsap.quickTo(preview, 'rotate', { duration: 0.8, ease: 'power3' });
    let lastX = 0;
    $('.plist').addEventListener('pointermove', (e) => {
        px(e.clientX);
        py(e.clientY);
        rot(gsap.utils.clamp(-12, 12, (e.clientX - lastX) * 0.6));
        lastX = e.clientX;
    });
    $$('.prow').forEach((row) => {
        row.addEventListener('pointerenter', () => {
            previewImg.src = row.dataset.preview;
            gsap.to(preview, { autoAlpha: 1, scale: 1, duration: 0.4, ease: 'power3.out' });
        });
        row.addEventListener('pointerleave', () => gsap.to(preview, { autoAlpha: 0, scale: 0.8, duration: 0.3 }));
    });
}

/* ------------------------------------------------------------- blog filter */
const chips = $$('.chip[data-filter]');
chips.forEach((chip) => {
    chip.addEventListener('click', () => {
        chips.forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
        const f = chip.dataset.filter;
        const posts = $$('.post[data-category]');
        posts.forEach((p) => p.classList.toggle('is-hidden', f !== 'all' && p.dataset.category !== f));
        gsap.fromTo(posts.filter((p) => !p.classList.contains('is-hidden')),
            { y: 30, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.7, ease: 'expo.out', stagger: 0.06 });
        ScrollTrigger.refresh();
    });
});

/* ------------------------------------------------------ magnetic buttons */
if (finePointer && !reduceMotion) {
    $$('.magnetic').forEach((el) => {
        const inner = el.firstElementChild;
        const xTo = gsap.quickTo(el, 'x', { duration: 0.8, ease: 'elastic.out(1, 0.4)' });
        const yTo = gsap.quickTo(el, 'y', { duration: 0.8, ease: 'elastic.out(1, 0.4)' });
        el.addEventListener('pointermove', (e) => {
            const r = el.getBoundingClientRect();
            const dx = e.clientX - (r.left + r.width / 2);
            const dy = e.clientY - (r.top + r.height / 2);
            xTo(dx * 0.35);
            yTo(dy * 0.35);
            gsap.to(inner, { x: dx * 0.15, y: dy * 0.15, duration: 0.6 });
        });
        el.addEventListener('pointerleave', () => {
            xTo(0); yTo(0);
            gsap.to(inner, { x: 0, y: 0, duration: 0.8, ease: 'elastic.out(1, 0.4)' });
        });
    });
}

/* ---------------------------------------------------------------- cursor */
if (finePointer) {
    document.body.classList.add('has-cursor');
    const dot = $('.cursor__dot');
    const ring = $('.cursor__ring');
    const label = $('.cursor__label');
    const dx = gsap.quickTo(dot, 'x', { duration: 0.1 });
    const dy = gsap.quickTo(dot, 'y', { duration: 0.1 });
    const rx = gsap.quickTo(ring, 'x', { duration: 0.45, ease: 'power3' });
    const ry = gsap.quickTo(ring, 'y', { duration: 0.45, ease: 'power3' });
    window.addEventListener('pointermove', (e) => { dx(e.clientX); dy(e.clientY); rx(e.clientX); ry(e.clientY); }, { passive: true });

    document.addEventListener('pointerover', (e) => {
        const labelled = e.target.closest('[data-cursor]');
        const hoverable = e.target.closest('a, button, input, textarea, label');
        document.body.classList.toggle('cursor-label', !!labelled);
        document.body.classList.toggle('cursor-hover', !!hoverable && !labelled);
        label.textContent = labelled ? labelled.dataset.cursor : '';
    });
    document.addEventListener('pointerleave', () => gsap.to('.cursor', { autoAlpha: 0 }));
    document.addEventListener('pointerenter', () => gsap.to('.cursor', { autoAlpha: 1 }));
}

/* ------------------------------------------------------------ mobile menu */
const toggle = $('.nav__toggle');
function closeMenu() {
    document.body.classList.remove('menu-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open menu');
}
toggle.addEventListener('click', () => {
    const open = document.body.classList.toggle('menu-open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

// hide nav on scroll down, show on scroll up
let lastY = 0;
ScrollTrigger.create({
    start: 0, end: 'max',
    onUpdate: (self) => {
        const y = self.scroll();
        document.body.classList.toggle('nav-hidden', y > lastY && y > 200 && !document.body.classList.contains('menu-open'));
        document.body.classList.toggle('nav-solid', y > 40);
        lastY = y;
    },
});

/* ----------------------------------------------------------- contact form */
const form = $('#contactForm');
if (form) {
    const status = $('.form__status');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!form.checkValidity()) {
            status.textContent = 'Please fill in your name, a valid email and a message.';
            status.dataset.state = 'error';
            form.querySelector(':invalid')?.focus();
            return;
        }
        const btn = form.querySelector('button[type="submit"] span');
        btn.textContent = 'Sending…';
        status.textContent = '';
        try {
            const res = await fetch('https://api.web3forms.com/submit', { method: 'POST', body: new FormData(form) });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || 'Request failed');
            status.textContent = "Thanks — message received. I'll get back to you soon.";
            status.dataset.state = 'ok';
            form.reset();
        } catch (err) {
            status.textContent = `Couldn't send that (${err.message}). Please try again, or reach me on LinkedIn.`;
            status.dataset.state = 'error';
        } finally {
            btn.textContent = 'Send message';
        }
    });
}
