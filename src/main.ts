import { platformBrowser } from '@angular/platform-browser';
import './app/shared/app-icons';

import { AppModule } from './app/app.module';

platformBrowser().bootstrapModule(AppModule)
  .catch(err => console.log(err));
