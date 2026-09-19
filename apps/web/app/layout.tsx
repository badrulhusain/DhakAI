import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Agent Classroom', description: 'A place to learn by working alongside coding agents.' };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
