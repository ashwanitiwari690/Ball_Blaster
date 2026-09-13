import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular/lazy';
import { SharedModule } from '../../shared/shared.module';

import { DailyRewardsPageRoutingModule } from './daily-rewards-routing.module';

import { DailyRewardsPage } from './daily-rewards.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    SharedModule,
    DailyRewardsPageRoutingModule
  ],
  declarations: [DailyRewardsPage]
})
export class DailyRewardsPageModule {}
