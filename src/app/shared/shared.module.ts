import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular/lazy';
import { BottomNavComponent } from './components/bottom-nav/bottom-nav.component';
import { CoinPillComponent } from './components/coin-pill/coin-pill.component';
import { CoinIconComponent } from './components/coin-icon/coin-icon.component';

@NgModule({
  declarations: [BottomNavComponent, CoinPillComponent, CoinIconComponent],
  imports: [CommonModule, IonicModule],
  exports: [BottomNavComponent, CoinPillComponent, CoinIconComponent, CommonModule, IonicModule],
})
export class SharedModule {}
