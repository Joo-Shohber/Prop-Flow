import { Readable } from 'node:stream';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { fileTypeFromBuffer } from 'file-type';
import { ImageRef } from './image-ref.interface.js';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
} from './upload.constants.js';

type AllowedMime = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(config: ConfigService) {
    cloudinary.config({
      cloud_name: config.getOrThrow<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: config.getOrThrow<string>('CLOUDINARY_API_KEY'),
      api_secret: config.getOrThrow<string>('CLOUDINARY_API_SECRET'),
    });
  }

  async uploadImages(
    files: Express.Multer.File[],
    folder: string,
    maxCount: number,
  ): Promise<ImageRef[]> {
    if (!files.length)
      throw new BadRequestException('At least one image is required');

    if (files.length > maxCount) {
      throw new BadRequestException(
        `A maximum of ${maxCount} images is allowed`,
      );
    }
    return Promise.all(files.map((file) => this.uploadOne(file, folder)));
  }

  async deleteImages(images: ImageRef[]): Promise<void> {
    await Promise.all(
      images.map((image) =>
        cloudinary.uploader.destroy(image.publicId).catch((error) => this.logger.error(error)),
      ),
    );
  }

  private async uploadOne(
    file: Express.Multer.File,
    folder: string,
  ): Promise<ImageRef> {
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      throw new BadRequestException(
        `${file.originalname} exceeds the ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB limit`,
      );
    }

    // Trust the file's actual bytes, not the client-supplied extension or mimetype.
    const detected = await fileTypeFromBuffer(file.buffer);
    if (
      !detected ||
      !ALLOWED_IMAGE_MIME_TYPES.includes(detected.mime as AllowedMime)
    ) {
      throw new BadRequestException(
        `${file.originalname} is not a valid image (jpeg, png or webp)`,
      );
    }

    return new Promise<ImageRef>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder, resource_type: 'image' },
        (error, result) => {
          if (error || !result)
            return reject(error ?? new Error('Upload failed'));
          resolve({ url: result.secure_url, publicId: result.public_id });
        },
      );
      Readable.from(file.buffer).pipe(stream);
    });
  }
}
