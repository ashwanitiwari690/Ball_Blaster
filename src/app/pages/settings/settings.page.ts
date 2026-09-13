import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { SettingsService } from '../../core/services/settings.service';
import { AudioService } from '../../core/services/audio.service';
import { PlayerProfileService } from '../../core/services/player-profile.service';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
  standalone: false,
})
export class SettingsPage {
  readonly settings$ = this.settingsService.view$;

  constructor(
    private readonly router: Router,
    private readonly settingsService: SettingsService,
    private readonly audioService: AudioService,
    private readonly playerProfileService: PlayerProfileService,
    private readonly alertCtrl: AlertController,
    private readonly toastCtrl: ToastController
  ) {}

  goBack(): void {
    this.router.navigateByUrl('/home');
  }

  toggleSound(enabled: boolean): void {
    this.settingsService.update({ soundEnabled: enabled });
  }

  toggleMusic(enabled: boolean): void {
    this.settingsService.update({ musicEnabled: enabled });
    if (enabled) this.audioService.startMusic();
  }

  toggleHaptics(enabled: boolean): void {
    this.settingsService.update({ hapticsEnabled: enabled });
  }

  async confirmReset(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Reset level progress?',
      message: 'This resets your player level and games-played count back to the start. Your coin balance is not affected. This cannot be undone.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Reset', role: 'destructive', handler: () => this.resetLevel() },
      ],
    });
    await alert.present();
  }

  private async resetLevel(): Promise<void> {
    this.playerProfileService.reset();
    const toast = await this.toastCtrl.create({
      message: 'Level progress reset. Coins were not affected.',
      duration: 1800,
      color: 'success',
      position: 'bottom',
    });
    await toast.present();
  }
}
