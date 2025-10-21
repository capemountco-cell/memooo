import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Copy, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ShareModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
}

export const ShareModal = ({ open, onOpenChange, sessionId }: ShareModalProps) => {
  const [shareData, setShareData] = useState<{ url: string; pin: string; slug: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open && !shareData) {
      generateShareLink();
    }
  }, [open]);

  const generateShareLink = async () => {
    setIsGenerating(true);
    try {
      // Generate random PIN (6 digits)
      const pin = Math.floor(100000 + Math.random() * 900000).toString();
      
      // Generate random slug (8 characters)
      const slug = Math.random().toString(36).substring(2, 10);
      
      // Insert into shared_sessions
      const { error } = await supabase
        .from('shared_sessions')
        .insert({
          session_id: sessionId,
          pin,
          slug,
        });

      if (error) throw error;

      const url = `${window.location.origin}/s/${slug}`;
      setShareData({ url, pin, slug });
      toast.success('Share link generated', { duration: 1000 });
    } catch (error) {
      console.error('Error generating share link:', error);
      toast.error('Failed to generate share link', { duration: 1000 });
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Copied to clipboard', { duration: 1000 });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setShareData(null);
      setCopied(false);
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share Recording</DialogTitle>
        </DialogHeader>
        
        {isGenerating ? (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <p className="text-sm text-muted-foreground">Generating share link...</p>
          </div>
        ) : shareData ? (
          <div className="flex flex-col items-center gap-6 py-4">
            {/* QR Code */}
            <div className="bg-white p-4 rounded-lg">
              <QRCodeSVG value={shareData.url} size={200} />
            </div>

            {/* URL */}
            <div className="w-full space-y-2">
              <label className="text-sm font-medium">Shareable URL</label>
              <div className="flex gap-2">
                <Input value={shareData.url} readOnly className="font-mono text-sm" />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(shareData.url)}
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </Button>
              </div>
            </div>

            {/* PIN */}
            <div className="w-full space-y-2">
              <label className="text-sm font-medium">Access PIN</label>
              <div className="flex gap-2">
                <Input value={shareData.pin} readOnly className="font-mono text-2xl font-bold text-center tracking-wider" />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(shareData.pin)}
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Recipients will need this PIN to access the recording
              </p>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
