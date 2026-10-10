/**
 * White X Store — 3D Cyber Globe & Perspective Mesh Background Engine
 * Powered by Three.js & Vanta.js Globe
 * Matches exact Vanta Globe aesthetic: Hot Pink wireframe terrain, rotating 3D sphere,
 * radiating white light rays, dynamic mouse tracking, and day/night mode adaptation.
 */

(function init3DBackground() {
  let vantaEffect = null;

  function ensureVantaContainer() {
    let container = document.getElementById('vanta-3d-bg');
    if (!container) {
      container = document.createElement('div');
      container.id = 'vanta-3d-bg';
      container.setAttribute('aria-hidden', 'true');
      document.body.prepend(container);
    }
    return container;
  }

  function getThemeColors() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light' || 
                    document.body.getAttribute('data-theme') === 'light';
    if (isLight) {
      return {
        color: 0xe11d48,          // Ruby / Hot Pink
        color2: 0x9333ea,         // Violet rays
        backgroundColor: 0xfff0f5 // Frosted blush rose
      };
    }
    return {
      color: 0xff2a85,            // Electric Hot Pink (exact Vanta screenshot)
      color2: 0xffffff,           // Radiant white light needles
      backgroundColor: 0x0c0414   // Cosmic deep violet-black (exact Vanta screenshot)
    };
  }

  function startVantaGlobe() {
    const container = ensureVantaContainer();
    if (!container) return false;

    // Check if Three.js and Vanta.GLOBE are loaded
    if (typeof window.VANTA !== 'undefined' && typeof window.VANTA.GLOBE === 'function') {
      try {
        const colors = getThemeColors();
        vantaEffect = window.VANTA.GLOBE({
          el: container,
          mouseControls: true,
          touchControls: true,
          gyroControls: false,
          minHeight: 200.0,
          minWidth: 200.0,
          scale: 1.0,
          scaleMobile: 0.85,
          color: colors.color,
          color2: colors.color2,
          backgroundColor: colors.backgroundColor,
          size: 1.05,
          points: 12.0,
          maxDistance: 22.0,
          spacing: 16.0,
          showDots: true
        });

        const canvas = container.querySelector('canvas');
        if (canvas) {
          canvas.style.position = 'fixed';
          canvas.style.top = '0';
          canvas.style.left = '0';
          canvas.style.width = '100vw';
          canvas.style.height = '100vh';
          canvas.style.zIndex = '-1';
          canvas.style.pointerEvents = 'none';
        }

        return true;
      } catch (err) {
        console.warn('Vanta Globe init error, falling back to 3D Canvas:', err);
      }
    }
    return false;
  }

  // Graceful Fallback if WebGL/Vanta isn't available
  function startFallback3D(container) {
    if (!container) container = ensureVantaContainer();
    if (container.querySelector('canvas')) return;

    const canvas = document.createElement('canvas');
    canvas.id = 'hero3dCanvas';
    canvas.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; z-index:-1; pointer-events:none;';
    container.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width, height;
    function resize() {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize, { passive: true });

    // 3D Particles & Cyber Grid with Hot Pink glow
    const particles = [];
    const count = Math.min(60, Math.floor(window.innerWidth / 25));
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        z: Math.random() * 2 + 0.5,
        vx: (Math.random() - 0.5) * 0.8,
        vy: (Math.random() - 0.5) * 0.8,
        radius: Math.random() * 2.5 + 1.2,
        alpha: Math.random() * 0.7 + 0.3,
        color: Math.random() > 0.4 ? '#ff2a85' : '#ff0055'
      });
    }

    let mouse = { x: null, y: null };
    window.addEventListener('mousemove', (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    }, { passive: true });

    function animate() {
      ctx.clearRect(0, 0, width, height);

      // Perspective Grid Lines at bottom
      ctx.strokeStyle = 'rgba(255, 42, 133, 0.14)';
      ctx.lineWidth = 1;
      const horizonY = height * 0.65;
      const numLines = 14;
      for (let i = 0; i <= numLines; i++) {
        const x = (width / numLines) * i;
        ctx.beginPath();
        ctx.moveTo(width / 2, horizonY - 40);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      // Draw and connect particles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha;
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#ff2a85';
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;

        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `rgba(255, 42, 133, ${(1 - dist / 120) * 0.25})`;
            ctx.stroke();
          }
        }
      }

      requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
  }

  // Handle Day/Night Theme Switch Dynamically
  window.addEventListener('themeChanged', (e) => {
    const theme = e.detail && e.detail.theme ? e.detail.theme : 
                  (document.documentElement.getAttribute('data-theme') || 'dark');
    if (vantaEffect && typeof vantaEffect.setOptions === 'function') {
      const colors = getThemeColors();
      vantaEffect.setOptions({
        color: colors.color,
        color2: colors.color2,
        backgroundColor: colors.backgroundColor
      });
    }
  });

  // Initialization when DOM is ready
  function init() {
    const initialized = startVantaGlobe();
    if (!initialized) {
      setTimeout(() => {
        if (!startVantaGlobe()) {
          startFallback3D();
        }
      }, 150);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
