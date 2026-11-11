'use client';

import { useState } from 'react';
import {
  Container,
  Typography,
  Button,
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Divider,
  Chip,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import {
  Download as DownloadIcon,
  Verified as VerifiedIcon,
  Print as PrintIcon,
  Description as DocIcon,
  PictureAsPdf as PdfIcon,
  FolderZip as FolderZipIcon,
  Article as MdIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';
import ResumeContent from './ResumeContent';

// Resume file formats available for download
const resumeFormats = [
  { 
    extension: 'pdf', 
    label: 'PDF Document', 
    icon: PdfIcon, 
    description: 'Optimized for viewing and printing',
    filename: 'chris_harper-resume.pdf'
  },
  { 
    extension: 'docx', 
    label: 'Word Document', 
    icon: DocIcon, 
    description: 'Editable Microsoft Word format',
    filename: 'chris_harper-resume.docx'
  },
  { 
    extension: 'odt', 
    label: 'OpenOffice Document', 
    icon: DocIcon, 
    description: 'Open source document format',
    filename: 'chris_harper-resume.odt'
  },
  { 
    extension: 'md', 
    label: 'Markdown', 
    icon: MdIcon, 
    description: 'Plain text with formatting',
    filename: 'chris_harper-resume.md'
  },
];

export default function ResumePage() {
  const [verificationOpen, setVerificationOpen] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [honeypot, setHoneypot] = useState<string>('');
  const [dialogStartTime, setDialogStartTime] = useState<number>(0);
  const [downloadMenuAnchor, setDownloadMenuAnchor] = useState<null | HTMLElement>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [pendingDownload, setPendingDownload] = useState<typeof resumeFormats[0] | 'zip' | null>(null);

  const handleDownloadClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setDownloadMenuAnchor(event.currentTarget);
  };

  const handleSingleDownload = async (format: typeof resumeFormats[0]) => {
    setDownloadMenuAnchor(null);
    
    if (!isVerified) {
      setPendingDownload(format);
      setVerificationOpen(true);
      setDialogStartTime(Date.now());
      return;
    }

    // Proceed with download if already verified
    await executeDownload(format);
  };

  const executeDownload = async (format: typeof resumeFormats[0]) => {
    setDownloading(format.extension);
    
    try {
      const link = document.createElement('a');
      link.href = `/resume/${format.filename}`;
      link.download = format.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Download failed:', error);
    } finally {
      setTimeout(() => setDownloading(null), 1000);
    }
  };

  const handleDownloadAll = async () => {
    setDownloadMenuAnchor(null);
    
    if (!isVerified) {
      setPendingDownload('zip');
      setVerificationOpen(true);
      setDialogStartTime(Date.now());
      return;
    }

    // Proceed with zip download if already verified
    await executeZipDownload();
  };

  const executeZipDownload = async () => {
    setDownloading('zip');

    try {
      // Import JSZip dynamically to avoid bundle bloat
      const JSZipModule = await import('jszip');
      const JSZip = JSZipModule.default || JSZipModule;
      const zip = new JSZip();
      const folder = zip.folder('chris_harper-resume');

      // Fetch all resume files
      const downloadPromises = resumeFormats.map(async (format) => {
        try {
          const response = await fetch(`/resume/${format.filename}`);
          if (response.ok) {
            const blob = await response.blob();
            folder?.file(format.filename, blob);
          }
        } catch (error) {
          console.error(`Failed to fetch ${format.filename}:`, error);
        }
      });

      await Promise.all(downloadPromises);
      
      // Generate and download zip
      const content = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = 'chris_harper-resume-all-formats.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch (error) {
      console.error('Zip download failed:', error);
    } finally {
      setTimeout(() => setDownloading(null), 1000);
    }
  };

  const handleVerification = () => {
    // Check honeypot - if filled, it's a bot
    if (honeypot) {
      console.log('Bot detected: honeypot field filled');
      return; // Silently reject
    }

    // Check if enough time has passed (at least 2 seconds)
    const timeTaken = Date.now() - dialogStartTime;
    if (timeTaken < 2000) {
      return; // Too fast, likely a bot
    }

    setIsVerified(true);
    setVerificationOpen(false);
    setHoneypot(''); // Reset honeypot
    
    // Execute the pending download after verification
    if (pendingDownload) {
      setTimeout(async () => {
        if (pendingDownload === 'zip') {
          await executeZipDownload();
        } else {
          await executeDownload(pendingDownload);
        }
        setPendingDownload(null);
      }, 500);
    }
  };

  const handleHoneypotChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setHoneypot(event.target.value);
  };

  // The PDF is generated from the Markdown by scripts/export-resume.mjs, so
  // printing it prints the same resume the page shows.
  const handlePrint = () => {
    window.open('/resume/chris_harper-resume.pdf', '_blank', 'noopener,noreferrer');
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
        <Box sx={{ textAlign: 'center', mb: 6 }}>
          <Typography variant="h2" component="h1" sx={{ mb: 2 }}>
            Resume
          </Typography>
          <Typography variant="h6" sx={{ color: 'text.secondary', mb: 4 }}>
            Staff AI Enablement Engineer
          </Typography>
          
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap', mb: 2 }}>
            <Button
              variant="outlined"
              size="large"
              startIcon={<PrintIcon />}
              onClick={handlePrint}
              sx={{ px: 4, py: 1.5 }}
            >
              Print Resume
            </Button>
            
            <Button
              variant="contained"
              size="large"
              startIcon={isVerified ? <VerifiedIcon /> : <DownloadIcon />}
              endIcon={<ExpandMoreIcon />}
              onClick={handleDownloadClick}
              disabled={downloading !== null}
              sx={{
                px: 4,
                py: 1.5,
                background: 'linear-gradient(135deg, #749dc4, #94bce3)',
                '&:hover': {
                  background: 'linear-gradient(135deg, #2563eb, #0891b2)',
                },
              }}
            >
              {downloading ? `Downloading...` : isVerified ? 'Download Resume (Verified)' : 'Choose Download Format'}
            </Button>
          </Box>

          {/* Download Menu */}
          <Menu
            anchorEl={downloadMenuAnchor}
            open={Boolean(downloadMenuAnchor)}
            onClose={() => setDownloadMenuAnchor(null)}
            anchorOrigin={{
              vertical: 'bottom',
              horizontal: 'center',
            }}
            transformOrigin={{
              vertical: 'top',
              horizontal: 'center',
            }}
            PaperProps={{
              sx: {
                minWidth: 280,
                background: 'rgba(43,43,45, 0.95)',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(148, 163, 184, 0.1)',
              }
            }}
          >
            {resumeFormats.map((format) => {
              const Icon = format.icon;
              return (
                <MenuItem 
                  key={format.extension}
                  onClick={() => handleSingleDownload(format)}
                  disabled={downloading === format.extension}
                >
                  <ListItemIcon>
                    <Icon sx={{ color: '#749dc4' }} />
                  </ListItemIcon>
                  <ListItemText 
                    primary={format.label}
                    secondary={format.description}
                  />
                  <Chip 
                    label={format.extension.toUpperCase()} 
                    size="small" 
                    sx={{ 
                      ml: 1,
                      background: 'rgba(116,157,196, 0.1)',
                      color: '#749dc4',
                      border: '1px solid rgba(116,157,196, 0.3)',
                    }} 
                  />
                </MenuItem>
              );
            })}
            <Divider sx={{ my: 1, backgroundColor: 'rgba(148, 163, 184, 0.2)' }} />
            <MenuItem onClick={handleDownloadAll} disabled={downloading === 'zip'}>
              <ListItemIcon>
                <FolderZipIcon sx={{ color: '#94bce3' }} />
              </ListItemIcon>
              <ListItemText 
                primary="Download All Formats"
                secondary="ZIP archive with all resume formats"
              />
              <Chip 
                label="ZIP" 
                size="small" 
                sx={{ 
                  ml: 1,
                  background: 'rgba(148,188,227, 0.1)',
                  color: '#94bce3',
                  border: '1px solid rgba(148,188,227, 0.3)',
                }} 
              />
            </MenuItem>
          </Menu>
          
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2, fontStyle: 'italic' }}>
            Print optimized version available • Choose format first, verify once for all downloads
          </Typography>
          
          {isVerified && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center', mb: 3 }}>
              {resumeFormats.map((format) => (
                <Chip
                  key={format.extension}
                  label={format.extension.toUpperCase()}
                  size="small"
                  sx={{
                    background: 'rgba(116,157,196, 0.1)',
                    color: '#749dc4',
                    border: '1px solid rgba(116,157,196, 0.3)',
                  }}
                />
              ))}
              <Chip
                label="ZIP"
                size="small"
                sx={{
                  background: 'rgba(148,188,227, 0.1)',
                  color: '#94bce3',
                  border: '1px solid rgba(148,188,227, 0.3)',
                }}
              />
            </Box>
          )}
          {isVerified && (
            <Alert severity="success" sx={{ mt: 2, maxWidth: 'md', mx: 'auto' }}>
              ✅ Verified! You can now download any resume format without further verification.
            </Alert>
          )}
        </Box>

        {/* Resume Content */}
        <Box sx={{ mb: 8 }}>
          <ResumeContent showContactInfo={isVerified} />
        </Box>

      {/* Verification Dialog */}
      <Dialog 
        open={verificationOpen} 
        onClose={() => setVerificationOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Human Verification Required
          {pendingDownload && (
            <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 'normal', mt: 1 }}>
              {pendingDownload === 'zip' 
                ? 'Downloading all formats after verification'
                : `Downloading ${pendingDownload.label} after verification`
              }
            </Typography>
          )}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 3 }}>
            To protect sensitive contact information, please verify that you're human. This verification will allow you to download any format without repeating this step.
          </Typography>
          
          {/* Honeypot field - hidden from users */}
          <Box 
            component="input" 
            type="text"
            name="website"
            value={honeypot}
            onChange={handleHoneypotChange}
            sx={{ 
              position: 'absolute',
              left: '-9999px',
              opacity: 0,
              pointerEvents: 'none',
              tabIndex: -1
            }}
            tabIndex={-1}
            autoComplete="off"
          />
          
          <Typography variant="body2" sx={{ textAlign: 'center', color: 'text.secondary' }}>
            Click "Verify & Download" to proceed with the download.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVerificationOpen(false)}>Cancel</Button>
          <Button 
            onClick={handleVerification}
            variant="contained"
          >
            Verify & Download
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}