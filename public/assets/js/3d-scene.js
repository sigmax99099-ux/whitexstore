/**
 * White X Store — Interactive 3D Cyber Particle Mesh
 * 60fps Canvas particle field with depth, connecting lines, and mouse reactivity.
 */

(function init3DHeroCanvas() {
  const canvas = document.getElementById('hero3dCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let width, height;
  let particles = [];
  let mouse = { x: null, y: null, radius: 140 };

  const PARTICLE_COUNT = 65;
  const CONNECT_DISTANCE = 110;

  function resize() {
    const parent = canvas.parentElement;
    width = canvas.width = parent.offsetWidth || window.innerWidth;
    height = canvas.height = parent.offsetHeight || 600;
  }

  class Particle {
    constructor() {
      this.x = Math.random() * width;
      this.y = Math.random() * height;
      this.z = Math.random() * 2 + 0.5; // depth
      this.radius = (Math.random() * 2 + 1) * this.z;
      this.vx = (Math.random() - 0.5) * 0.7 * this.z;
      this.vy = (Math.random() - 0.5) * 0.7 * this.z;
      this.alpha = Math.random() * 0.6 + 0.3;
      this.color = Math.random() > 0.3 ? '#ef4444' : '#dc2626';
    }

    update() {
      this.x += this.vx;
      this.y += this.vy;

      if (this.x < 0) this.x = width;
      if (this.x > width) this.x = 0;
      if (this.y < 0) this.y = height;
      if (this.y > height) this.y = 0;

      // Mouse interaction
      if (mouse.x !== null && mouse.y !== null) {
        const dx = mouse.x - this.x;
        const dy = mouse.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < mouse.radius) {
          const force = (mouse.radius - dist) / mouse.radius;
          const angle = Math.atan2(dy, dx);
          this.x -= Math.cos(angle) * force * 3;
          this.y -= Math.sin(angle) * force * 3;
        }
      }
    }

    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fillStyle = this.color;
      ctx.globalAlpha = this.alpha;
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#ef4444';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  }

  function initParticles() {
    particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push(new Particle());
    }
  }

  function drawConnections() {
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const p1 = particles[i];
        const p2 = particles[j];
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < CONNECT_DISTANCE) {
          const alpha = (1 - dist / CONNECT_DISTANCE) * 0.25;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = `rgba(239, 68, 68, ${alpha})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }
  }

  let animationFrame;
  function animate() {
    ctx.clearRect(0, 0, width, height);

    drawConnections();
    particles.forEach(p => {
      p.update();
      p.draw();
    });

    animationFrame = requestAnimationFrame(animate);
  }

  window.addEventListener('resize', () => {
    resize();
    initParticles();
  });

  const hero = document.getElementById('hero-section') || canvas.parentElement;
  if (hero) {
    hero.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    });

    hero.addEventListener('mouseleave', () => {
      mouse.x = null;
      mouse.y = null;
    });
  }

  resize();
  initParticles();
  animate();
})();
