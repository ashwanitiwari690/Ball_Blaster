import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { PlayerProfileService } from '../../core/services/player-profile.service';

@Component({
  selector: 'app-leaderboard',
  templateUrl: './leaderboard.page.html',
  styleUrls: ['./leaderboard.page.scss'],
  standalone: false,
})
export class LeaderboardPage {
  readonly profile$ = this.profileService.view$;

  constructor(private readonly router: Router, private readonly profileService: PlayerProfileService) {}

  goBack(): void {
    this.router.navigateByUrl('/home');
  }
}
