import { pdfjs } from 'react-pdf';

// Worker served as a static asset from /public — avoids all Vite bundling issues with pdfjs-dist 5.x
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
