const motion = {
  reduced: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  enter(element) {
    if (this.reduced()) return;
    gsap.fromTo(element, { y: 18, opacity: 0, scale: .96 }, {
      y: 0, opacity: 1, scale: 1, duration: .55, ease: 'back.out(1.6)', clearProps: 'transform,opacity'
    });
  },
  dialog(element) {
    element.showModal();
    if (!this.reduced()) gsap.fromTo(element, { y: 12, opacity: 0, scale: .98 }, {
      y: 0, opacity: 1, scale: 1, duration: .2, ease: 'power2.out', clearProps: 'transform,opacity'
    });
  },
  confetti(rect) {
    if (this.reduced() || !rect || document.body.classList.contains('rolled-up')) return;
    const layer = document.createElement('div');
    layer.className = 'confetti-layer'; layer.setAttribute('aria-hidden', 'true');
    document.body.append(layer);
    const x = Math.max(24, Math.min(innerWidth - 24, rect.left + 20));
    const y = Math.max(50, Math.min(innerHeight - 20, rect.top + rect.height / 2));
    const theme = getComputedStyle(document.documentElement);
    const colors = ['--accent', '--muted', '--text'].map(name => theme.getPropertyValue(name).trim());
    const timeline = gsap.timeline({ onComplete: () => layer.remove() });
    for (let i = 0; i < 18; i++) {
      const piece = document.createElement('span'); piece.className = 'confetti-piece';
      piece.style.backgroundColor = colors[i % colors.length]; layer.append(piece);
      gsap.set(piece, { x, y, rotation: Math.random() * 180 });
      timeline.to(piece, { x: x + (Math.random() - .3) * 100, rotation: Math.random() * 360,
        duration: .8, ease: 'power2.out' }, 0);
      timeline.to(piece, { y: y - 16 - Math.random() * 25, duration: .25, ease: 'power2.out' }, 0);
      timeline.to(piece, { y: y + 35 + Math.random() * 35, opacity: 0, duration: .55, ease: 'power2.in' }, .25);
    }
  }
};
