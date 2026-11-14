import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Lock } from 'lucide-react';

interface PinInputProps {
  onSubmit: (pin: string) => void;
  isLoading: boolean;
  error: string | null;
}

export const PinInput = ({ onSubmit, isLoading, error }: PinInputProps) => {
  const [pin, setPin] = useState(['', '', '', '', '', '']);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    // Auto-focus first input on mount
    inputRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    // Clear inputs on error
    if (error) {
      setPin(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    }
  }, [error]);

  useEffect(() => {
    // Auto-submit when all 6 digits are entered
    if (pin.every(digit => digit !== '') && !isLoading) {
      onSubmit(pin.join(''));
    }
  }, [pin, isLoading, onSubmit]);

  const handleChange = (index: number, value: string) => {
    // Only allow digits, NFKC normalization
    const normalized = value.normalize('NFKC').replace(/[^0-9]/g, '');
    
    if (normalized.length > 1) {
      // Handle paste
      const digits = normalized.slice(0, 6).split('');
      const newPin = [...pin];
      digits.forEach((digit, i) => {
        if (index + i < 6) {
          newPin[index + i] = digit;
        }
      });
      setPin(newPin);
      
      // Focus last filled input or next empty
      const nextIndex = Math.min(index + digits.length, 5);
      inputRefs.current[nextIndex]?.focus();
    } else if (normalized.length === 1) {
      const newPin = [...pin];
      newPin[index] = normalized;
      setPin(newPin);
      
      // Auto-advance to next input
      if (index < 5) {
        inputRefs.current[index + 1]?.focus();
      }
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && pin[index] === '' && index > 0) {
      // Move to previous input on backspace if current is empty
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.every(digit => digit !== '')) {
      onSubmit(pin.join(''));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex justify-center gap-2">
        {pin.map((digit, index) => (
          <Input
            key={index}
            ref={el => inputRefs.current[index] = el}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={(e) => handleChange(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            className="w-12 h-14 text-center text-2xl font-bold"
            disabled={isLoading}
            autoComplete="off"
          />
        ))}
      </div>

      {error && (
        <p className="text-sm text-destructive text-center">
          {error}
        </p>
      )}

      <Button
        type="submit"
        className="w-full"
        disabled={!pin.every(digit => digit !== '') || isLoading}
      >
        {isLoading ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
            Verifying...
          </>
        ) : (
          <>
            <Lock className="h-4 w-4 mr-2" />
            Access Recording
          </>
        )}
      </Button>

      <p className="text-xs text-muted-foreground text-center">
        Enter the 6-digit PIN to access this recording
      </p>
    </form>
  );
};
