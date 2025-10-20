import { useEffect, useRef } from 'react';

interface WaveformProps {
  analyser: AnalyserNode | null;
}

export const Waveform = ({ analyser }: WaveformProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();

  useEffect(() => {
    if (!analyser || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // Set high DPI canvas for sharper rendering
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    // Configure analyser for smoother data
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.85;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    // Use fewer points for smoother rendering
    const displayPoints = 200;

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);

      analyser.getByteTimeDomainData(dataArray);

      // Clear with transparency
      ctx.clearRect(0, 0, rect.width, rect.height);

      // Drawing settings
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      ctx.beginPath();

      const step = bufferLength / displayPoints;
      const sliceWidth = rect.width / displayPoints;
      const centerY = rect.height / 2;
      const amplification = 1.5;

      for (let i = 0; i < displayPoints; i++) {
        const index = Math.floor(i * step);
        const v = (dataArray[index] / 128.0 - 1) * amplification;
        const y = centerY + (v * centerY * 0.8);
        const x = i * sliceWidth;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          // Use quadratic curves for smoother lines
          const prevX = (i - 1) * sliceWidth;
          const cpX = (prevX + x) / 2;
          const prevIndex = Math.floor((i - 1) * step);
          const prevV = (dataArray[prevIndex] / 128.0 - 1) * amplification;
          const prevY = centerY + (prevV * centerY * 0.8);
          const cpY = (prevY + y) / 2;
          
          ctx.quadraticCurveTo(prevX, prevY, cpX, cpY);
        }
      }

      ctx.stroke();
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [analyser]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full max-w-2xl mx-auto opacity-90"
      style={{ width: '700px', height: '200px' }}
    />
  );
};
