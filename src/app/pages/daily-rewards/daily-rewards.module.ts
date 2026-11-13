import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { IonicModule } from '@ionic/angular/lazy';
import { SharedModule } from '../../shared/shared.module';

import { DailyRewardsPageRoutingModule } from './daily-rewards-routing.module';

import { DailyRewardsPage } from './daily-rewards.page';

@NgModule({
  imports: [
    CommonModule,
    IonicModule,
    SharedModule,
    DailyRewardsPageRoutingModule
  ],
  declarations: [DailyRewardsPage]
})
export class DailyRewardsPageModule {}
