'use client';

import { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Divider,
  Skeleton,
  Alert,
} from '@mui/material';
import { LinkedIn as LinkedInIcon } from '@mui/icons-material';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ResumeContentProps {
  showContactInfo?: boolean;
}

export default function ResumeContent({ showContactInfo = false }: ResumeContentProps) {
  const [resumeContent, setResumeContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchResumeContent = async () => {
      try {
        const response = await fetch('/resume/chris_harper-resume.md');
        if (!response.ok) {
          throw new Error('Failed to fetch resume content');
        }
        const content = await response.text();
        setResumeContent(content);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load resume');
      } finally {
        setLoading(false);
      }
    };

    fetchResumeContent();
  }, []);

  // Process the markdown content to hide/show contact information and convert bullet points
  const processContent = (content: string) => {
    let processedContent = content;

    if (!showContactInfo) {
      // Replace contact information with placeholder for non-verified users
      processedContent = processedContent.replace(
        /\[?chris@cloudcodetree\.com\]?(?:\(mailto:chris@cloudcodetree\.com\))? \| 512-938-9697/g,
        'Contact via cloudcodetree.com/contact'
      );
    }

    // Convert bullet point lists to proper markdown lists
    // Handle consecutive bullet points and group them properly
    processedContent = processedContent.replace(
      /^• (.+)$/gm,
      '- $1'
    );

    // Ensure proper spacing around lists by adding blank lines before and after list groups
    processedContent = processedContent.replace(
      /(?<!^|\n\n)(^- .+(?:\n- .+)*)/gm,
      '\n$1'
    );

    processedContent = processedContent.replace(
      /(^- .+(?:\n- .+)*)(?!\n\n|\n- |\n*$)/gm,
      '$1\n'
    );

    return processedContent;
  };

  if (loading) {
    return (
      <Card className="glass">
        <CardContent sx={{ p: 4 }}>
          <Box sx={{ textAlign: 'center', mb: 4 }}>
            <Skeleton variant="text" height={60} width="60%" sx={{ mx: 'auto', mb: 2 }} />
            <Skeleton variant="text" height={32} width="80%" sx={{ mx: 'auto', mb: 2 }} />
            <Skeleton variant="text" height={24} width="40%" sx={{ mx: 'auto' }} />
          </Box>
          <Divider sx={{ my: 3 }} />
          {Array.from({ length: 8 }).map((_, index) => (
            <Box key={index} sx={{ mb: 3 }}>
              <Skeleton variant="text" height={24} width="30%" sx={{ mb: 1 }} />
              <Skeleton variant="text" height={20} width="100%" />
              <Skeleton variant="text" height={20} width="100%" />
              <Skeleton variant="text" height={20} width="80%" />
            </Box>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="glass">
        <CardContent sx={{ p: 4 }}>
          <Alert severity="error">
            {error}. Please try refreshing the page or contact directly via cloudcodetree.com/contact.
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass">
      <CardContent sx={{ p: 4 }}>
        <Box sx={{
          '& h1': { 
            textAlign: 'center',
            fontSize: '2.5rem',
            fontWeight: 700,
            mb: 2,
            background: 'linear-gradient(135deg, #749dc4, #94bce3)',
            backgroundClip: 'text',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          },
          '& h3': { 
            color: '#749dc4', 
            fontWeight: 600, 
            mb: 2, 
            fontSize: '1.5rem',
            borderBottom: '2px solid rgba(116,157,196, 0.3)', 
            pb: 1,
            mt: 4,
          },
          '& p': { 
            mb: 2, 
            lineHeight: 1.8,
          },
          '& ul': {
            paddingLeft: '24px',
            marginBottom: '24px',
            marginLeft: '0',
            listStyleType: 'disc',
            listStylePosition: 'outside',
            textAlign: 'left',
            '& li': {
              marginBottom: '8px',
              lineHeight: 1.6,
              paddingLeft: '4px',
              display: 'list-item',
              textAlign: 'left',
              '& p': {
                margin: 0,
                textAlign: 'left',
              },
              '& strong': {
                display: 'inline',
              }
            }
          },
          '& strong': {
            color: '#94bce3',
            fontWeight: 600,
          },
          '& a': {
            color: '#749dc4',
            textDecoration: 'none',
            '&:hover': {
              textDecoration: 'underline',
            },
          },
          // Style the contact line specially - only target the actual contact paragraph
          '& > div > p:first-of-type': {
            textAlign: 'center',
            color: 'text.secondary',
            fontSize: '1.1rem',
            mb: 4,
          },
        }}>
          {!showContactInfo && (
            <Box sx={{ textAlign: 'center', mb: 3 }}>
              <Alert severity="info" sx={{ maxWidth: 'md', mx: 'auto' }}>
                Contact information is protected. Complete verification to access full resume with phone and email.
              </Alert>
            </Box>
          )}
          
          <ReactMarkdown 
            remarkPlugins={[remarkGfm]}
            components={{
              // Custom rendering for specific elements
              h1: ({ children }) => (
                <Typography 
                  variant="h2" 
                  component="h1" 
                  sx={{
                    textAlign: 'center',
                    fontWeight: 700,
                    mb: 2,
                    background: 'linear-gradient(135deg, #749dc4, #94bce3)',
                    backgroundClip: 'text',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  {children}
                </Typography>
              ),
              h3: ({ children }) => (
                <>
                  <Divider sx={{ my: 3, background: 'rgba(116,157,196, 0.3)' }} />
                  <Typography 
                    variant="h4" 
                    component="h3"
                    sx={{ 
                      color: '#749dc4', 
                      fontWeight: 600, 
                      mb: 2,
                      fontSize: '1.5rem',
                      borderBottom: '2px solid rgba(116,157,196, 0.3)', 
                      pb: 1 
                    }}
                  >
                    {children}
                  </Typography>
                </>
              ),
              // Handle list items and their content
              li: ({ children }) => (
                <li style={{ marginBottom: '8px', lineHeight: 1.6, textAlign: 'left' }}>
                  {children}
                </li>
              ),
              // Handle paragraphs - render content inline for list items
              p: ({ children, ...props }) => {
                const content = children?.toString() || '';

                // Filter out non-DOM props
                const { node, siblingCount, ...domProps } = props as any;

                // Check if this is the contact info paragraph
                if (content.includes('cloudcodetree.com') && content.includes('linkedin.com')) {
                  return (
                    <Box sx={{
                      textAlign: 'center',
                      mb: 4,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexWrap: 'wrap',
                      gap: 1,
                      color: 'text.secondary',
                      fontSize: '1.1rem'
                    }}>
                      <LinkedInIcon fontSize="small" sx={{ mr: 0.5 }} />
                      <Typography variant="body1" component="span">
                        {children}
                      </Typography>
                    </Box>
                  );
                }

                return (
                  <Typography
                    variant="body1"
                    sx={{ mb: 2, lineHeight: 1.8 }}
                    {...domProps}
                  >
                    {children}
                  </Typography>
                );
              },
            }}
          >
            {processContent(resumeContent)}
          </ReactMarkdown>
        </Box>
      </CardContent>
    </Card>
  );
}