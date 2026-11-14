// Person 1: lets students "Add to Home Screen" and open FindOn full-screen like an app.
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FindOn: USC Lost & Found',
    short_name: 'FindOn',
    description: 'Campus-wide lost and found for USC. Report what you found or lost and get it back.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#990000',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
