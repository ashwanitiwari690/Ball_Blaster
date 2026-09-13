import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { DailyRewardsPage } from './daily-rewards.page';

const routes: Routes = [
  {
    path: '',
    component: DailyRewardsPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class DailyRewardsPageRoutingModule {}
