import { bootIdentity } from '../lib/duel/embed';
import { createRoot } from 'react-dom/client';
import Home from '../app/page';
import Lab from '../app/lab/page';
import '../app/globals.css';
bootIdentity();
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).get('view') === 'lab' ? <Lab /> : <Home />);
