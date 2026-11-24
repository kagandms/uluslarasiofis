export const TOPI_STATES = Object.freeze([
    'idle',
    'thinking',
    'understood',
    'checking',
    'handoff',
    'confused',
    'sleepy',
    'hello'
]);

const TOPI_STATE_CLASSES = Object.freeze(
    TOPI_STATES.filter((state) => state !== 'idle').map((state) => `is-${state}`)
);

const TOPI_STYLE_ID = 'topi-mascot-styles';

// Exact byte-for-byte copy of design/mascot/topi/topi-cat.svg (12,140 bytes SVG + trailing newline).
export const TOPI_SVG_SOURCE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" class="mascot-svg mascot-cat" aria-hidden="true" focusable="false"><title>Topi</title><style>/*<![CDATA[*/.mascot-cat{--p:var(--public-burgundy,#7e1830);--o:var(--mascot-outline,var(--public-burgundy-hover,#641126));--s:var(--public-burgundy-soft,#fbf2f4);--b:var(--public-burgundy-border,#e2c0c8);--c:var(--mascot-coat,#f6efe9);--m:var(--mascot-mark,#c7bec2);--S:var(--mascot-surface,#fffbf8);--D:var(--mascot-card,#fff);--i:var(--mascot-ink,#241b22);--a:var(--mascot-accent,#d89b27);--V:var(--mascot-speed,1.5);--e:cubic-bezier(.34,1.56,.64,1);& path{stroke-linejoin:round}.h{display:none}.c,.C{fill:var(--c)}.M{fill:var(--m)}.B{fill:var(--b)}.s,.F{fill:var(--S)}.p,.D0{fill:var(--D)}.c,.O,.o,.s{stroke:var(--o)}.c,.O,.J{stroke-width:2.3}.O,.r,.k,.b{fill:none;stroke-linecap:round}.s{stroke-width:2}.k,.b,.p{stroke-width:1.7}.k{stroke:var(--i)}.b,.p{stroke:var(--p)}.a{--n:none;--d:2.8s;--t:ease-in-out;--l:0s;--r:infinite;--u:0;--v:0;--w:0;--f:0;--x:0;--y:0;--z:0;--q:0;transform-box:fill-box;animation:var(--n) calc(var(--d)/var(--V)) var(--t) calc(var(--l)/var(--V)) var(--r) forwards}.g{transform-origin:50% 98%}.d{transform-origin:50% 95%;--n:br}.f{transform-origin:50% 92%;--n:km;--d:3.7s;--y:-.9px;--v:2.2;--q:.4px;--w:-1.8}.l{transform-origin:55% 68%}.u{transform-origin:45% 68%;--n:et;--d:5.1s}.t{--n:kr;--d:3s;--u:-4;--v:4}.x{transform-origin:100% 87%;--u:-3}.y{transform-origin:73% 88%;--l:.06s}.z{transform-origin:68% 83%;--l:.12s;--u:-6;--v:5}.q{transform-origin:100% 30%}:is(.i,.W,.U,.Z,.J,.D){transform-origin:50%}.i{--n:bk;--d:8.2s}.P{transform-origin:15% 65%}.w{transform-origin:12% 85%}.H{transform-origin:15% 30%}.K{transform-origin:20% 85%}.Q{transform-origin:50% 60%}:is(.W,.U,.Q,.P,.H,.J){--t:var(--e)}.W{--n:dt;--d:1.5s}.n{--l:.22s}.m{--l:.44s}.U{--n:sp;--d:2.1s}.v{--l:-.7s}.V{--l:-1.4s}.Z{--n:zz}&:is(.is-thinking,.is-understood,.is-checking,.is-handoff){.I,.R{display:none}.u{--n:kp;--v:-8}}&:is(.is-thinking,.is-understood,.is-checking,.is-confused,.is-hello) .l{--n:kp;--v:8}&:is(.is-understood,.is-sleepy) .ie{display:none}&.is-thinking{.s1{display:inline}.d{--d:1.9s;--t:var(--e);--y:-1.1px}.t{--d:1.4s;--u:-5;--v:5}.x{--u:-4}.z{--u:-7;--v:6}.f{--d:2.5s;--l:.15s}.eo{translate:.9px -1.2px}.E{--n:km;--d:3.4s;--x:-2.2px;--y:-.3px;--z:.8px}.P{--n:k3;--d:2.1s;--y:-1.6px;--v:-14;--w:4}}&.is-understood{.s2{display:inline}.g{--n:hp;--d:2.6s;--t:var(--e)}.t{--d:1.5s;--t:var(--e)}.x{--u:7;--v:10}.y{--u:-14;--v:-11}.z{--u:2;--v:16}:is(.l,.u){--d:2.6s;--t:var(--e)}.w{--n:kr;--d:1.05s;--u:-9;--v:14}}&.is-checking{.s3{display:inline}.t{--d:3.8s}.x{--u:-7;--v:-2}.y{--u:-3;--v:4}.z{--u:-2;--v:5}:is(.f,.E,.K){--n:km;--d:2.9s}.f{--l:.14s;--u:-2;--x:1.2px;--y:-.6px;--v:5;--z:.7px;--q:.5px;--w:2}.eo{translate:.8px .8px}.E{--x:.9px;--y:-.5px;--z:-.7px;--q:.5px}.K{--f:-1px;--u:-6;--x:2.4px;--y:-1.5px;--v:9;--z:1.5px;--q:1.8px;--w:4}.D{--n:km;--d:2.3s;--y:-.3px;--v:-15;--w:5}}&.is-handoff{.s4{display:inline}.g{--n:km;--x:1.2px;--y:.3px;--v:4;--z:.8px;--w:2}.eo{translate:0 1.2px}.t{--d:1.7s;--t:var(--e)}.x{--u:6;--v:11}.y{--u:-13;--v:-9}.z{--u:-4;--v:12}.H{--n:k3;--x:1.2px;--y:2.2px;--v:12;--w:-3}.J{--n:k3;--l:.08s;--y:1.7px}}&.is-confused{.I{display:none}.s5{display:inline}.f{rotate:-7deg;--n:kr;--d:3.2s;--u:-8;--v:8}.eo{translate:0 .2px}.u{--n:kr;--d:3.2s;--u:14;--v:22}.t{--d:4s}.x{--u:1;--v:5}.y{--u:-4;--v:1}.z{--u:-18;--v:6}.Q{--n:km;--d:2.3s;--u:-7;--y:-2.5px;--v:9;--q:-.5px;--w:-4}}&.is-sleepy{.I,.x{display:none}.s6{display:inline}.d{--d:4.4s}.f{translate:0 2.4px;--n:nd;--d:4.8s}.u{--n:none}.q{--n:kr;--d:4.4s;--v:-2.5}}&.is-hello{.w{display:inline}.a{--d:1.6s;--r:1}.i{--d:8.2s;--r:infinite}.g{--n:hp;--t:var(--e)}.d{--n:none}:is(.f,.l,.u){--t:var(--e)}.u{--n:kp;--v:-8}.t{--n:tw;--v:5;--w:-4}.y{--v:3}.z{--w:-6}.w{--n:hw;--t:var(--e)}.R{opacity:0;--n:hr}}&.mascot-cat.is-calm{.a{--n:none}:is(.i,.t,.q){--r:infinite}.i{--n:bk;--d:8.2s}:is(.t,.q){--n:kr;--d:6s;--v:-1}.t{--u:1}}}@keyframes bk{0%,43%,47%,88%,92%,96%,to{scale:1}45%,90%,94%{scale:1 .08}}@keyframes br{0%,to{translate:0;scale:1}50%{translate:0 var(--y);scale:1.03 1.04}}@keyframes tw{0%,to{rotate:0deg}18%,56%{rotate:calc(var(--v)*1deg)}37%,75%{rotate:calc(var(--w)*1deg)}}@keyframes kr{0%,to{rotate:calc(var(--u)*1deg)}50%{rotate:calc(var(--v)*1deg)}}@keyframes kp{0%,to{rotate:0deg;translate:0}25%,65%{rotate:calc(var(--v)*1deg);translate:0 -.8px}}@keyframes km{0%,to{translate:var(--f);rotate:calc(var(--u)*1deg)}35%{translate:var(--x) var(--y);rotate:calc(var(--v)*1deg)}70%{translate:var(--z) var(--q);rotate:calc(var(--w)*1deg)}}@keyframes k3{0%,76%,to{translate:0;rotate:0deg}12%,36%,60%{translate:var(--x) var(--y);rotate:calc(var(--v)*1deg)}24%,48%{translate:0 -.4px;rotate:calc(var(--w)*1deg)}}@keyframes et{0%,82%,94%,to{rotate:0deg}85%{rotate:13deg}88%{rotate:-4deg}91%{rotate:8deg}}@keyframes dt{0%,65%,to{scale:.85;opacity:.45}30%{translate:0 -2.4px;scale:1.18;opacity:1}}@keyframes hp{0%,66%,to{translate:0;scale:1}11%{translate:0 .7px;scale:1.06 .92}25%{translate:0 -4.4px;scale:.95 1.06}39%{translate:0 .8px;scale:1.07 .91}51%{translate:0 -.8px;scale:.99 1.02}}@keyframes sp{0%,to{scale:.62;opacity:.38}38%{scale:1.22;rotate:18deg;opacity:1}70%{scale:.88;rotate:-8deg;opacity:.82}}@keyframes nd{0%,to{translate:0 2.2px;rotate:-1deg}70%{translate:0 4.8px;rotate:-8deg}79%{translate:0 1px;rotate:2deg}89%{translate:0 2.4px;rotate:-1.5deg}}@keyframes zz{0%{translate:-.6px 1.8px;scale:.82;opacity:0}22%,60%{translate:0;scale:1;opacity:1}to{translate:1.1px -2.8px;scale:1.08;opacity:0}}@keyframes hw{0%{rotate:-15deg;opacity:0}12%,42%,70%{rotate:14deg;opacity:1}27%,56%{rotate:-12deg;opacity:1}86%{rotate:-14deg;opacity:.8}to{rotate:-18deg;opacity:0}}@keyframes hr{0%,84%{opacity:0}94%,to{opacity:1}}@media(prefers-reduced-motion:reduce){.mascot-cat *{animation:none!important}}/*]]>*/</style><defs><g id="emblem"><path fill="#444444" d="M118 8h129v18H118zm151 0h132v18H269z"/><path fill="#8b1328" d="M35 37H247V475H118V255H35ZM269 37H460V255H401V475H269Z"/></g><path id="c" d="M49.2 23.3C52 26.4 52.5 31.2 50.2 35.2 47.2 40.2 40.4 42.4 32 42.4 23.6 42.4 16.8 40.2 13.8 35.2 11.5 31.2 12 26.4 14.8 23.3"/><ellipse id="p" rx="4" ry="2.6" class="s"/><path id="s" d="M28.4 34.8Q30.2 36.8 32 34.8 33.8 36.8 35.6 34.8" class="k"/><g id="e" fill="var(--i)"><circle cx="23.5" cy="27" r="2.8"/><circle cx="40.5" cy="27" r="2.8"/><g fill="#fff"><circle cx="24.4" cy="26.1" r=".9"/><circle cx="41.4" cy="26.1" r=".9"/></g></g><path id="t" d="M6.1 42.2Q5.8 38.2 4.4 35.4A1 1 0 0 1 6 34.2Q8.8 37 9.5 41.8"/><path id="q" d="M17.8 50.6Q6.4 49.6 6.2 56.2 6 61.2 11.8 60.6A1 1 0 0 0 11.8 58.6Q9.6 58.4 10.2 55.8 10.8 54.2 17.8 56.4"/></defs><g class="a g"><g class="a t x"><path class="C" d="M17.8 57Q11.5 57 8.4 51.5L12.2 48.9Q13.8 51 17.8 51Z"/><path class="O" d="M17.8 57Q11.5 57 8.4 51.5M12.2 48.9Q13.8 51 17.8 51"/><g class="a t y"><path class="C" d="M8.4 51.5Q6.2 47 6.1 42.2L9.5 41.8Q9.9 45.6 12.2 48.9A2.3 2.3 0 0 1 8.4 51.5Z"/><path class="M" d="M6.3 44.5 9.9 44.1 10.5 45.6 6.5 46.1Z"/><path class="O" d="M8.4 51.5Q6.2 47 6.1 42.2M9.5 41.8Q9.9 45.6 12.2 48.9"/><g class="a t z"><circle cx="7.8" cy="42" r="1.7" class="C"/><use href="#t" class="C"/><path class="M" d="M4.9 36.4 7 35.3 7.9 36.6 5.4 37.9ZM5.7 39.4 8.7 38.9 9.1 40.3 5.9 40.8Z"/><use href="#t" class="O"/></g></g></g><g class="a q s6 h"><use href="#q" class="C"/><path class="M" d="M9.7 58.2 9.5 60.6 10.7 60.7 10.8 58.5ZM6.6 57.9 9.8 56.6 10 57.8 7.4 59.4Z"/><use href="#q" class="O"/></g><g class="a d"><path d="M16.5 40C14.5 48.5 16.5 59.2 23 59.2H41C47.5 59.2 49.5 48.5 47.5 40Z" class="c"/><ellipse cx="32" cy="50" rx="10.4" ry="7.2" class="F"/><path d="M19.5 41.2Q32 45.2 44.5 41.2" class="r" stroke="var(--p)" stroke-width="3.2"/><circle cx="32" cy="44.1" r="1.3" fill="var(--a)" class="o" stroke-width=".9"/><rect x="24" y="44.8" width="16" height="15.4" rx="2" class="D0" stroke="var(--p)" stroke-width="1.4"/><use href="#emblem" transform="translate(25.4 46.1) scale(.0265)"/></g><g class="a f"><g class="a l"><path d="M15.8 25.5L14.8 23.3 14.4 12.2C14.3 9.8 17 8.9 19.1 10.4L25.6 15 27.6 17Z" class="c"/><path d="M17.2 19.6L17.1 13 22.2 16.6Z" class="B"/></g><g class="a u"><path d="M36.4 17L38.4 15 44.9 10.4C47 8.9 49.7 9.8 49.6 12.2L49.2 23.3 48.2 25.5Z" class="c"/><path d="M46.8 19.6L46.9 13 41.8 16.6Z" class="B"/></g><use href="#c" class="C"/><path d="M14.8 25V23.3Q20.5 21 25.6 15C29.6 14.1 34.4 14.1 38.4 15Q43.5 21 49.2 23.3V25Z" class="C"/><use href="#c" class="O"/><path d="M25.6 15C29.6 14.1 34.4 14.1 38.4 15" class="O"/><g class="M"><rect x="30.6" y="15" width="2.8" height="5" rx="1.4"/><rect x="26.2" y="15.6" width="2.4" height="3.8" rx="1.2"/><rect x="35.4" y="15.6" width="2.4" height="3.8" rx="1.2"/></g><path d="M10.2 30.6L16.4 31.3M11.2 34.6L16.8 33.9M53.8 30.6L47.6 31.3M52.8 34.6L47.2 33.9" class="r o" stroke-width="1.6"/><ellipse cx="32" cy="33.8" rx="7.6" ry="4.6" class="F"/><path d="M30.1 31Q32 30.2 33.9 31L32 33.2Z" fill="var(--public-burgundy-light,#9a203d)"/><g class="a i ie"><g class="eo"><g class="a E"><use href="#e"/></g></g></g><use href="#s" class="I"/><path d="M29.8 35.6Q32 34.8 34.2 35.6" class="k s1 h"/><g class="s2 h"><path d="M20.4 27.6Q23.5 23.4 26.6 27.6M37.4 27.6Q40.5 23.4 43.6 27.6" class="k" stroke-width="2.2"/><g class="B" opacity=".85"><circle cx="18.2" cy="31" r="2"/><circle cx="45.8" cy="31" r="2"/></g><use href="#s"/></g><use href="#s" class="s4 h"/><path d="M29.4 35.2Q32 36.4 34.6 35.2" class="k s3 h"/><g class="s5 h"><path d="M20.2 22.8Q23.5 21.4 26.2 22.8M37.8 22.8Q40.5 21.4 43.8 22.8" class="r o" stroke-width="1.5"/><path d="M29.6 35.6Q32 34.4 34.4 35.6" class="k"/></g><g class="s6 h"><path d="M20.4 27Q23.5 30 26.6 27M37.4 27Q40.5 30 43.6 27" class="k" stroke-width="2.1"/><path d="M30.4 35.4Q32 36.2 33.6 35.4" class="k" stroke-width="1.5"/></g></g><use href="#p" x="18.5" y="58.2"/><use href="#p" class="a R" x="45.5" y="58.2"/><path class="a P s s1 h" d="M42.8 48.2C46.6 45.2 51 46.8 49.8 51.2 48.6 54.4 43.4 54.5 42.2 51.4Z"/><g class="a w s2 h"><path d="M45.8 51.5C49.8 50.8 55.6 47.4 56.2 42.8 56.6 39.8 53.6 38.4 51.3 40.2 49.4 41.8 47.8 45.4 45.6 48.2Z" class="s"/><circle cx="53.1" cy="42.8" r="1.3" class="B"/></g><path class="a H s s4 h" d="M43.5 49.5C48.8 48.5 52.2 52 50 56 48.4 58.6 44 57.5 43.2 53.8Z"/></g><g class="s1 h" fill="var(--p)"><rect x="42.5" y="1.4" width="19.8" height="8.8" rx="4.4" class="p"/><circle class="a W" cx="47.7" cy="5.8" r="1.4"/><circle class="a W n" cx="52.4" cy="5.8" r="1.4"/><circle class="a W m" cx="57.1" cy="5.8" r="1.4"/></g><g class="s2 h" fill="var(--a)"><path class="a U o" d="M55.8 7.4L57.2 11 60.8 12.4 57.2 13.8 55.8 17.4 54.4 13.8 50.8 12.4 54.4 11Z" stroke-width="1.2"/><circle class="a U v" cx="60.4" cy="7.2" r="1.2"/><path class="a U V o" d="M50.2 3.8L51 5.6 52.8 6.4 51 7.2 50.2 9 49.4 7.2 47.6 6.4 49.4 5.6Z" stroke-width=".9"/></g><g class="s4 h"><circle cx="54.2" cy="56.2" r="5.8" class="p"/><path class="a b J" d="M51.4 55L54.2 58.2 57 55"/></g><g class="s3 h"><rect x="47.5" y="42.2" width="13.6" height="16.8" rx="1.8" class="D0 o" stroke-width="1.8"/><path d="M50.5 46.6H58.1M50.5 50.4H56.5M50.5 54.2H54.9" class="r" stroke="var(--b)" stroke-width="1.6"/><path class="a D o" d="M57.6 42.2L61.1 45.7 57.6 45.7Z" fill="var(--s)" stroke-width="1.2"/><g class="a K"><path d="M49.6 51.8L45.2 56.8" class="r o" stroke-width="2.9"/><circle cx="53" cy="48.2" r="5" fill="var(--s)" fill-opacity=".75" stroke="var(--p)" stroke-width="2.1"/><path d="M50.7 46.4A3.2 3.2 0 0 1 53.2 45" class="r" stroke="#fff" stroke-width="1.3"/><ellipse cx="45.8" cy="56.6" rx="3.7" ry="2.5" class="s"/></g></g><g class="s5 h"><g class="a Q"><circle cx="55.5" cy="9.2" r="6.8" class="p"/><path d="M53.4 7.5C53.4 5.9 54.7 5.1 55.8 5.2 57.1 5.3 57.8 6.2 57.7 7.3 57.6 8.5 55.8 8.8 55.7 10" class="b" stroke-width="2"/><circle cx="55.7" cy="12.6" r="1.1" fill="var(--p)"/></g></g><g class="s6 h"><rect x="45.6" y="1.2" width="16.8" height="10.4" rx="5.2" class="p"/><path class="a b Z" d="M48.8 6H52.2L48.8 9.2H52.2"/><path class="a b Z V" d="M54.2 3.7H59L54.2 8.5H59"/></g></svg>\n`;

export const TOPI_MOUSE_SVG_SOURCE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="mascot-svg mascot-mouse" aria-hidden="true" focusable="false"><path class="mouse-tail" d="M7.5 16.2Q4.2 16.8 3 14.2 2.2 12 4 10.6" fill="none" stroke="var(--public-burgundy-border,#c7bec2)" stroke-width="1.4" stroke-linecap="round"/><path d="M7.2 16C7.2 12.6 10.2 11.4 14 12.2 17.2 12.9 20 14.3 21.2 15.8 19.6 17.9 16.5 18.8 12.5 18.8 9 18.8 7.2 17.8 7.2 16Z" fill="var(--mascot-mark,#b5acb1)" stroke="var(--mascot-outline,var(--public-burgundy-hover,#641126))" stroke-width="1.3" stroke-linejoin="round"/><circle cx="15" cy="11.2" r="2.7" fill="var(--mascot-mark,#b5acb1)" stroke="var(--mascot-outline,var(--public-burgundy-hover,#641126))" stroke-width="1.2"/><circle cx="15.2" cy="11.3" r="1.4" fill="var(--public-burgundy-border,#e2c0c8)"/><circle cx="17.6" cy="14.6" r=".95" fill="var(--mascot-ink,#241b22)"/><circle cx="21.2" cy="15.7" r="1" fill="var(--public-burgundy,#7e1830)"/><path d="M19.8 16.4 22.4 15.8M19.8 16.9 22.3 17.5M10.5 18.8 10 20.2M16 18.8 16.8 20" fill="none" stroke="var(--mascot-outline,var(--public-burgundy-hover,#641126))" stroke-width="1" stroke-linecap="round"/></svg>';

export const TOPI_YARN_SVG_SOURCE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="mascot-svg mascot-yarn" aria-hidden="true" focusable="false"><path class="yarn-tail" d="M5.2 17.5Q2.8 18.8 2 16.4 1.4 14.3 3.6 13.6" fill="none" stroke="var(--public-burgundy,#7e1830)" stroke-width="1.4" stroke-linecap="round"/><circle cx="12.5" cy="12.5" r="7.5" fill="var(--public-burgundy-border,#e2c0c8)" stroke="var(--mascot-outline,var(--public-burgundy-hover,#641126))" stroke-width="1.3"/><path d="M7.2 8.2Q12.5 11.4 18.5 8.8M6 12.2Q12.2 15.2 19.6 12.6M7.6 16.4Q12.8 18.2 17.8 15.8M9.5 5.8Q12 12.2 9.4 18.8M14.4 5.4Q16.2 12.2 13.8 19.4" fill="none" stroke="var(--public-burgundy,#7e1830)" stroke-width="1.2" stroke-linecap="round"/></svg>';

export const TOPI_BALL_SVG_SOURCE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="mascot-svg mascot-ball" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="7.5" fill="var(--mascot-accent,#d89b27)" stroke="var(--mascot-outline,var(--public-burgundy-hover,#641126))" stroke-width="1.3"/><path d="M5.4 8.4Q12 11.4 18.6 8.4M5.4 15.6Q12 12.6 18.6 15.6" fill="none" stroke="var(--public-burgundy,#7e1830)" stroke-width="1.5" stroke-linecap="round"/><path d="M12 4.5Q14.8 12 12 19.5" fill="none" stroke="var(--mascot-surface,#fffbf8)" stroke-width="1.3" stroke-linecap="round"/><circle cx="9.2" cy="8.8" r="1.2" fill="var(--mascot-surface,#fffbf8)"/></svg>';

export const TOPI_FEATHER_SVG_SOURCE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="mascot-svg mascot-feather" aria-hidden="true" focusable="false"><path d="M19.8 4.2C14.8 4.6 9.8 7.5 6.8 12.2L8.7 12.7 6 14.2C5.4 15.3 5 16.5 4.8 17.6 6.2 17.4 7.7 17 9.2 16.3L10.3 14.5 11.4 15.2C15.8 12.6 19 8.6 19.8 4.2Z" fill="var(--public-burgundy-border,#e2c0c8)" stroke="var(--mascot-outline,var(--public-burgundy-hover,#641126))" stroke-width="1.2" stroke-linejoin="round"/><path d="M19.2 4.8C16.2 5.4 13.8 7 12.4 9.2L15.4 10.6C17.4 8.8 18.8 6.8 19.2 4.8Z" fill="var(--mascot-accent,#d89b27)"/><path d="M3.2 20.6Q9.6 13.8 18.6 5.4" fill="none" stroke="var(--public-burgundy,#7e1830)" stroke-width="1.3" stroke-linecap="round"/></svg>';

export const TOPI_TOYS = Object.freeze(['mouse', 'yarn', 'ball', 'feather']);

let instanceSeq = 0;

function normalizeState(state) {
    return typeof state === 'string' && TOPI_STATES.includes(state) ? state : 'idle';
}

function extractTopiStyleText() {
    const startTag = '<style>';
    const endTag = '</style>';
    const start = TOPI_SVG_SOURCE.indexOf(startTag);
    const end = TOPI_SVG_SOURCE.indexOf(endTag, start + startTag.length);
    if (start === -1 || end === -1) return '';
    return TOPI_SVG_SOURCE
        .slice(start + startTag.length, end)
        .replace(/^\/\*<!\[CDATA\[\*\//, '')
        .replace(/\/\*\]\]>\*\/$/, '');
}

const TOPI_STYLE_TEXT = extractTopiStyleText();

function namespaceSvgIds(svg) {
    instanceSeq += 1;
    const suffix = `-topi-${instanceSeq}`;
    const idMap = new Map();

    for (const el of svg.querySelectorAll('defs [id]')) {
        const oldId = el.getAttribute('id');
        if (!oldId) continue;
        const newId = `${oldId}${suffix}`;
        idMap.set(oldId, newId);
        el.setAttribute('id', newId);
    }

    if (idMap.size === 0) return;

    for (const el of svg.querySelectorAll('*')) {
        for (const attr of [...el.attributes]) {
            let nextValue = attr.value;
            if ((attr.localName === 'href' || attr.name === 'href' || attr.name === 'xlink:href') && nextValue.startsWith('#')) {
                const mapped = idMap.get(nextValue.slice(1));
                if (mapped) nextValue = `#${mapped}`;
            } else if (nextValue.includes('url(#')) {
                nextValue = nextValue.replace(/url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/g, (match, quote, refId) => {
                    const mapped = idMap.get(refId);
                    return mapped ? `url(${quote}#${mapped}${quote})` : match;
                });
            }
            if (nextValue !== attr.value) {
                if (attr.namespaceURI) {
                    el.setAttributeNS(attr.namespaceURI, attr.name, nextValue);
                } else {
                    el.setAttribute(attr.name, nextValue);
                }
            }
        }
    }
}

/**
 * Inserts the shared Topi mascot stylesheet into `document.head` at most once.
 * @param {Document} document Target document.
 * @returns {HTMLStyleElement|null} Existing or newly inserted style element.
 */
export function ensureTopiStyles(document) {
    if (!document) return null;
    const existing = document.getElementById(TOPI_STYLE_ID);
    if (existing) return existing;
    const target = document.head || document.documentElement || document.body;
    if (!target) return null;
    const style = document.createElement('style');
    style.id = TOPI_STYLE_ID;
    style.textContent = TOPI_STYLE_TEXT;
    target.append(style);
    return style;
}

/**
 * Swaps the active state class on a mounted Topi wrapper or root SVG element.
 * @param {Element|null} element `.topi` wrapper or `svg.mascot-cat` element.
 * @param {string} state Target state name from `TOPI_STATES` (invalid values fall back to `idle`).
 * @param {{calm?: boolean}} [options] Optional calm modifier override.
 * @returns {SVGElement|null} Updated SVG element or null if not found.
 */
export function setTopiState(element, state, { calm } = {}) {
    const svg = element?.classList?.contains('mascot-cat')
        ? element
        : element?.querySelector?.('svg.mascot-cat');
    if (!svg) return null;

    for (const cls of TOPI_STATE_CLASSES) {
        svg.classList.remove(cls);
    }

    const nextState = normalizeState(state);
    if (nextState !== 'idle') {
        svg.classList.add(`is-${nextState}`);
    }

    if (typeof calm === 'boolean') {
        svg.classList.toggle('is-calm', calm);
    }

    return svg;
}

function parseSvgElement(document, source) {
    if (!document) return null;
    const Parser = document?.defaultView?.DOMParser || globalThis.DOMParser;
    if (!Parser) {
        throw new Error('DOMParser is required to construct Topi SVG elements.');
    }

    const parsed = new Parser().parseFromString(source, 'image/svg+xml');
    parsed.documentElement.querySelector('style')?.remove();
    const svg = document.importNode(parsed.documentElement, true);
    namespaceSvgIds(svg);
    return svg;
}

/**
 * Creates a uniquely-namespaced Topi mascot instance wrapped in `<span class="topi" aria-hidden="true">`.
 * Strips the inline `<style>` tag; callers should invoke `ensureTopiStyles(document)` once per document.
 * @param {Document} document Target document.
 * @param {{state?: string, calm?: boolean, size?: number}} [options]
 * @returns {HTMLSpanElement|null}
 */
export function createTopi(document, { state = 'idle', calm = false, size = 28 } = {}) {
    const svg = parseSvgElement(document, TOPI_SVG_SOURCE);
    if (!svg) return null;

    const normalizedSize = Number.isFinite(Number(size)) && Number(size) > 0 ? String(Number(size)) : '28';
    svg.setAttribute('width', normalizedSize);
    svg.setAttribute('height', normalizedSize);
    svg.setAttribute('class', 'mascot-svg mascot-cat');

    const wrapper = document.createElement('span');
    wrapper.className = 'topi';
    wrapper.setAttribute('aria-hidden', 'true');
    wrapper.append(svg);

    setTopiState(wrapper, state, { calm: Boolean(calm) });
    return wrapper;
}

function createTopiToyElement(document, source, { className, svgClassName, size = 22 }) {
    const svg = parseSvgElement(document, source);
    if (!svg) return null;

    const normalizedSize = Number.isFinite(Number(size)) && Number(size) > 0 ? String(Number(size)) : '22';
    svg.setAttribute('width', normalizedSize);
    svg.setAttribute('height', normalizedSize);
    svg.setAttribute('class', svgClassName);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    const wrapper = document.createElement('span');
    wrapper.className = className;
    wrapper.setAttribute('aria-hidden', 'true');
    wrapper.append(svg);

    return wrapper;
}

/**
 * Creates a decorative inline mouse SVG wrapped in `<span class="topi-mouse" aria-hidden="true">`.
 * @param {Document} document Target document.
 * @param {{size?: number}} [options]
 * @returns {HTMLSpanElement|null}
 */
export function createTopiMouse(document, { size = 22 } = {}) {
    return createTopiToyElement(document, TOPI_MOUSE_SVG_SOURCE, {
        className: 'topi-mouse',
        svgClassName: 'mascot-svg mascot-mouse',
        size
    });
}

/**
 * Creates a decorative inline yarn-ball SVG wrapped in `<span class="topi-yarn" aria-hidden="true">`.
 * @param {Document} document Target document.
 * @param {{size?: number}} [options]
 * @returns {HTMLSpanElement|null}
 */
export function createTopiYarn(document, { size = 22 } = {}) {
    return createTopiToyElement(document, TOPI_YARN_SVG_SOURCE, {
        className: 'topi-yarn',
        svgClassName: 'mascot-svg mascot-yarn',
        size
    });
}

/**
 * Creates a decorative inline bouncing-ball SVG wrapped in `<span class="topi-ball" aria-hidden="true">`.
 * @param {Document} document Target document.
 * @param {{size?: number}} [options]
 * @returns {HTMLSpanElement|null}
 */
export function createTopiBall(document, { size = 22 } = {}) {
    return createTopiToyElement(document, TOPI_BALL_SVG_SOURCE, {
        className: 'topi-ball',
        svgClassName: 'mascot-svg mascot-ball',
        size
    });
}

/**
 * Creates a decorative inline feather SVG wrapped in `<span class="topi-feather" aria-hidden="true">`.
 * @param {Document} document Target document.
 * @param {{size?: number}} [options]
 * @returns {HTMLSpanElement|null}
 */
export function createTopiFeather(document, { size = 22 } = {}) {
    return createTopiToyElement(document, TOPI_FEATHER_SVG_SOURCE, {
        className: 'topi-feather',
        svgClassName: 'mascot-svg mascot-feather',
        size
    });
}

const TOPI_TOY_FACTORIES = Object.freeze({
    mouse: createTopiMouse,
    yarn: createTopiYarn,
    ball: createTopiBall,
    feather: createTopiFeather
});

/**
 * Picks the next Topi toy (`'mouse'`, `'yarn'`, `'ball'`, or `'feather'`),
 * ensuring the same toy never appears more than 2 rounds in a row.
 * Calls `random` exactly once per pick, including overridden picks.
 * @param {Array<'mouse'|'yarn'|'ball'|'feather'>} [previous] List of past toy picks.
 * @param {() => number} [random] Random number generator returning `[0, 1)`.
 * @returns {'mouse'|'yarn'|'ball'|'feather'}
 */
export function pickTopiToy(previous = [], random = Math.random) {
    const rawRoll = typeof random === 'function' ? random() : Math.random();
    const roll = Number.isFinite(rawRoll) ? rawRoll : 0;

    let choices = TOPI_TOYS;
    if (Array.isArray(previous) && previous.length >= 2) {
        const last = previous[previous.length - 1];
        const prev = previous[previous.length - 2];
        if (TOPI_TOYS.includes(last) && last === prev) {
            choices = TOPI_TOYS.filter((toy) => toy !== last);
        }
    }

    const index = Math.min(choices.length - 1, Math.max(0, Math.floor(roll * choices.length)));
    return choices[index];
}

/**
 * Creates an animated launcher playtime wrapper that alternates between Topi toys on animation cycles.
 * @param {Document} document Target document.
 * @param {{reducedMotion?: boolean, random?: () => number, size?: number, initialToy?: 'mouse'|'yarn'|'ball'|'feather'}} [options]
 * @returns {{element: HTMLSpanElement|null, next: () => ('mouse'|'yarn'|'ball'|'feather'|null), destroy: () => void}}
 */
export function createTopiPlaytime(
    document,
    { reducedMotion = false, random = Math.random, size = 22, initialToy = 'mouse' } = {}
) {
    if (reducedMotion || !document) {
        return {
            element: null,
            next: () => null,
            destroy() {}
        };
    }

    const wrapper = document.createElement('span');
    wrapper.className = 'topi-playtime';
    wrapper.setAttribute('aria-hidden', 'true');

    const history = [];
    let currentToyEl = null;
    let destroyed = false;

    const handleAnimationCycle = () => {
        if (destroyed) return;
        next();
    };

    function detachListeners(el) {
        if (!el) return;
        el.removeEventListener('animationiteration', handleAnimationCycle);
        el.removeEventListener('animationend', handleAnimationCycle);
    }

    function mountToy(toyName) {
        detachListeners(currentToyEl);
        const normalizedToy = TOPI_TOYS.includes(toyName) ? toyName : 'mouse';
        const createToy = TOPI_TOY_FACTORIES[normalizedToy];
        const nextEl = createToy(document, { size });
        if (!nextEl) {
            currentToyEl = null;
            return null;
        }
        wrapper.replaceChildren(nextEl);
        currentToyEl = nextEl;
        currentToyEl.addEventListener('animationiteration', handleAnimationCycle);
        currentToyEl.addEventListener('animationend', handleAnimationCycle);
        history.push(normalizedToy);
        return normalizedToy;
    }

    function next() {
        if (destroyed) return null;
        return mountToy(pickTopiToy(history, random));
    }

    function destroy() {
        if (destroyed) return;
        destroyed = true;
        detachListeners(currentToyEl);
        currentToyEl = null;
    }

    mountToy(TOPI_TOYS.includes(initialToy) ? initialToy : 'mouse');

    return {
        element: wrapper,
        next,
        destroy
    };
}
