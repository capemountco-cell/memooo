import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Copy, Check, Share2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { QRCodeSVG } from 'qrcode.react';

interface PinShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
}

export const PinShareDialog = ({ open, onOpenChange, sessionId }: PinShareDialogProps) => {
  const [pin, setPin] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState('');

  useEffect(() => {
    if (open && !pin) {
      generatePin();
    }
  }, [open]);

  const generatePin = async () => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-share-pin', {
        body: { session_id: sessionId },
      });

      if (error) throw error;

      setPin(data.pin);
      const url = `${window.location.origin}/s/${sessionId}`;
      setShareUrl(url);
      
      toast.success('Share link generated', { duration: 1000 });
    } catch (error) {
      console.error('Error generating PIN:', error);
      toast.error('Failed to generate share link', { duration: 1000 });
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success(`${label} copied to clipboard`, { duration: 1000 });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      setPin(null);
      setCopied(false);
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Share Recording
          </DialogTitle>
        </DialogHeader>

        {isGenerating ? (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <p className="text-sm text-muted-foreground">Generating secure share link...</p>
          </div>
        ) : pin ? (
          <div className="flex flex-col items-center gap-6 py-4">
            {/* QR Code */}
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <QRCodeSVG value={shareUrl} size={200} />
            </div>

            {/* Shareable URL */}
            <div className="w-full space-y-2">
              <label className="text-sm font-medium">Shareable Link</label>
              <div className="flex gap-2">
                <Input 
                  value={shareUrl} 
                  readOnly 
                  className="font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(shareUrl, 'Link')}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {/* PIN */}
            <div className="w-full space-y-2">
              <label className="text-sm font-medium">Access PIN</label>
              <div className="flex gap-2">
                <Input 
                  value={pin} 
                  readOnly 
                  className="font-mono text-3xl font-bold text-center tracking-widest"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(pin, 'PIN')}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Share this PIN separately. Recipients will need it to access the recording.
              </p>
            </div>

            <div className="w-full pt-2 border-t">
              <p className="text-xs text-muted-foreground text-center">
                🔒 PIN is encrypted and never stored in plaintext
              </p>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
